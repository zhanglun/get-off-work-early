import { Injectable, Inject } from '@nestjs/common';
import type { MessageDto } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';

export interface ImpactRow {
  episodeNo: number;
  episodeId: string;
  scenes: number;
  shots: number;
  prompts: number;
}

@Injectable()
export class ImpactService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 从修改文本识别目标资产与修改意图（「把X的A改成B」类）。 */
  async analyze(projectId: string, content: string): Promise<MessageDto | null> {
    const match = content.match(/把?(.{1,20}?)的?(.{1,12}?)(?:改成|换成|改为|更改为|改为)(.{1,40})/);
    if (!match) return null;
    const [, subject, field, next] = match;
    const assets = await this.prisma.projectAsset.findMany({ where: { projectId } });
    const target = assets.find((asset) =>
      asset.name === subject.trim() || subject.trim().includes(asset.name) || asset.name.includes(subject.trim()));
    if (!target) return null;

    const fieldKey = /衣|服|着/.test(field) ? 'clothing' : /发/.test(field) ? 'appearance' : /外观|长相|脸/.test(field) ? 'appearance' : 'canonicalDescription';
    const data = target.data as Record<string, string>;
    const before = data[fieldKey] ?? data.canonicalDescription ?? '';
    const after = next.trim().replace(/[。"」』]$/, '');

    const impact = await this.computeImpact(projectId, target.name, before);

    const conversation = await this.prisma.conversation.findUnique({ where: { projectId } });
    if (!conversation) return null;
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        kind: 'impact_confirm',
        content: `勘误范围确认：${target.name} 的 ${fieldKey === 'clothing' ? '服装' : fieldKey === 'appearance' ? '外观' : '描述'}——「${before.slice(0, 24)}」→「${after}」。影响 ${impact.length} 集 / ${impact.reduce((sum, row) => sum + row.shots, 0)} 镜 / ${impact.reduce((sum, row) => sum + row.prompts, 0)} Prompt。`,
        meta: {
          assetId: target.id,
          assetName: target.name,
          fieldKey,
          before,
          after,
          impact: impact as unknown as object[],
          mode: 'pending',
        } as object,
      },
    });
    await this.events.append(projectId, 'message', { messageId: message.id, role: 'assistant', kind: 'impact_confirm' });
    return {
      id: message.id,
      role: 'assistant',
      kind: 'impact_confirm',
      content: message.content,
      meta: message.meta,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /** 计算跨集影响：资产名出现在场次角色或镜头提示词中的范围。 */
  async computeImpact(projectId: string, assetName: string, _before: string): Promise<ImpactRow[]> {
    const episodes = await this.prisma.episode.findMany({
      where: { projectId },
      orderBy: { episodeNo: 'asc' },
      include: {
        scenes: {
          include: {
            shots: { where: { status: { not: 'failed' } } },
          },
        },
      },
    });
    const rows: ImpactRow[] = [];
    for (const episode of episodes) {
      let shots = 0;
      let scenes = 0;
      for (const scene of episode.scenes) {
        const inScene = ((scene.characters ?? []) as string[]).includes(assetName);
        const sceneShots = scene.shots.filter((shot) => {
          const payload = shot.payload as Record<string, unknown>;
          return inScene
            || JSON.stringify(payload).includes(assetName)
            || (typeof payload.imagePrompt === 'string' && payload.imagePrompt.includes(assetName));
        });
        if (sceneShots.length > 0) scenes++;
        shots += sceneShots.length;
      }
      if (shots > 0) {
        rows.push({ episodeNo: episode.episodeNo, episodeId: episode.id, scenes, shots, prompts: shots * 2 });
      }
    }
    return rows;
  }

  /** 确认：更新资产 + 版本（保留 5 版）+（可选）创建重生成任务。 */
  async confirm(projectId: string, messageId: string, mode: 'regenerate' | 'setting_only'): Promise<{ taskId: string | null }> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.kind !== 'impact_confirm') throw new Error('勘误消息不存在');
    const meta = (message.meta ?? {}) as unknown as {
      assetId: string; assetName: string; fieldKey: string; before: string; after: string; impact: ImpactRow[];
    };
    const asset = await this.prisma.projectAsset.findUnique({ where: { id: meta.assetId } });
    if (!asset) throw new Error('资产不存在');

    const data = { ...((asset.data ?? {}) as Record<string, string>), [meta.fieldKey]: meta.after };
    await this.prisma.projectAsset.update({
      where: { id: asset.id },
      data: { data, version: asset.version + 1, updatedAt: new Date() },
    });

    // 版本留痕（保留最近 5 版）
    const count = await this.prisma.assetVersion.count({ where: { targetType: 'project-asset', targetId: asset.id } });
    await this.prisma.assetVersion.create({
      data: {
        targetType: 'project-asset', targetId: asset.id, version: count + 1,
        before: { [meta.fieldKey]: meta.before } as object,
        after: { [meta.fieldKey]: meta.after } as object,
        reason: '对话修改', source: 'user',
      },
    });
    const versions = await this.prisma.assetVersion.findMany({
      where: { targetType: 'project-asset', targetId: asset.id },
      orderBy: { version: 'asc' },
    });
    if (versions.length > 5) {
      await this.prisma.assetVersion.deleteMany({
        where: { id: { in: versions.slice(0, versions.length - 5).map((v) => v.id) } },
      });
    }
    await this.prisma.message.update({ where: { id: messageId }, data: { meta: { ...meta, mode } as object } });

    let taskId: string | null = null;
    if (mode === 'regenerate' && meta.impact.length > 0) {
      const task = await this.prisma.domainTask.create({
        data: {
          kind: 'regeneration',
          status: 'queued',
          progress: { stage: 'shots', stages: {}, shotsDone: 0, shotsTotal: 0 },
          projectId,
          episodeId: meta.impact[0].episodeId,
          inputRef: JSON.stringify({
            assetId: asset.id, assetName: meta.assetName, fieldKey: meta.fieldKey,
            before: meta.before, after: meta.after,
            episodes: meta.impact,
          }),
        },
      });
      taskId = task.id;
      await this.events.append(projectId, 'run_started', { taskId, kind: 'regeneration', episodes: meta.impact.length });
    }
    await this.events.append(projectId, 'artifact_updated', { artifact: 'project-asset', assetId: asset.id, version: asset.version + 1 });
    return { taskId };
  }

  /** 版本历史。 */
  async versions(assetId: string) {
    const versions = await this.prisma.assetVersion.findMany({
      where: { targetType: 'project-asset', targetId: assetId },
      orderBy: { version: 'desc' },
    });
    return versions.map((v) => ({
      version: v.version,
      before: v.before,
      after: v.after,
      reason: v.reason,
      source: v.source,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  /** 回退到指定版本（作为新版本写入）。 */
  async rollback(projectId: string, assetId: string, version: number): Promise<void> {
    const asset = await this.prisma.projectAsset.findUnique({ where: { id: assetId } });
    const target = await this.prisma.assetVersion.findFirst({
      where: { targetType: 'project-asset', targetId: assetId, version },
    });
    if (!asset || !target) throw new Error('版本不存在');
    const before = asset.data as Record<string, string>;
    const after = { ...before, ...((target.before ?? {}) as Record<string, string>) };
    await this.prisma.projectAsset.update({
      where: { id: assetId },
      data: { data: after, version: asset.version + 1, updatedAt: new Date() },
    });
    const count = await this.prisma.assetVersion.count({ where: { targetType: 'project-asset', targetId: assetId } });
    await this.prisma.assetVersion.create({
      data: {
        targetType: 'project-asset', targetId: assetId, version: count + 1,
        before: before as object, after: after as object,
        reason: `回退到 v${version}`, source: 'user',
      },
    });
    await this.events.append(projectId, 'artifact_updated', { artifact: 'project-asset', assetId, change: 'rollback', toVersion: version });
  }
}
