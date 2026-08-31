import { Injectable, Inject } from '@nestjs/common';
import JSZip from 'jszip';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class ExportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 整项目 ZIP：project-assets.md + 每集 5 文件 + manifest（含被忽略穿帮）。 */
  async buildProjectZip(projectId: string): Promise<{ fileName: string; buffer: Buffer; manifest: Record<string, unknown> }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        episodes: { orderBy: { episodeNo: 'asc' }, include: { scriptVersions: true } },
        assets: true,
      },
    });
    if (!project) throw new Error('项目不存在');
    const zip = new JSZip();
    const generatedAt = new Date().toISOString();
    const episodeManifests: Record<string, unknown>[] = [];

    const assetLines = [`# ${project.name} · 项目级资产`, ''];
    for (const asset of project.assets) {
      const data = asset.data as Record<string, string>;
      assetLines.push(`## ${asset.name}（${asset.kind} · v${asset.version}）`, '');
      for (const [key, value] of Object.entries(data)) {
        assetLines.push(`- ${key}：${String(value)}`);
      }
      assetLines.push('');
    }
    zip.file('project-assets.md', assetLines.join('\n'));

    for (const episode of project.episodes) {
      const dir = `episode-${String(episode.episodeNo).padStart(2, '0')}`;
      const bible = await this.prisma.storyBible.findFirst({ where: { episodeId: episode.id }, orderBy: { version: 'desc' } });
      const scenes = await this.prisma.scene.findMany({
        where: { episodeId: episode.id },
        orderBy: { sceneNo: 'asc' },
        include: { shots: { orderBy: { sequence: 'asc' }, include: { prompts: true } } },
      });
      const issues = await this.prisma.issue.findMany({ where: { episodeId: episode.id } });

      const storyLines = [`# 第 ${episode.episodeNo} 集 · 故事资产`, ''];
      if (bible) {
        storyLines.push('## 摘要', bible.summary, '', '## Logline', bible.logline, '');
        const characters = (bible.characters ?? []) as Array<Record<string, string>>;
        for (const character of characters) {
          storyLines.push(`### ${character.name}`, `- 外观：${character.appearance ?? ''}`, `- 服装：${character.clothing ?? ''}`, `- 性格：${character.personality ?? ''}`, '');
        }
        const locations = (bible.locations ?? []) as Array<Record<string, string>>;
        for (const location of locations) {
          storyLines.push(`### 场景：${location.name}`, `- 布局：${location.layout ?? ''}`, `- 光线：${location.lighting ?? ''}`, '');
        }
      }
      zip.file(`${dir}/story-assets.md`, storyLines.join('\n'));

      const sceneLines = [`# 第 ${episode.episodeNo} 集 · 场次`, ''];
      for (const scene of scenes) {
        sceneLines.push(
          `## 第 ${scene.sceneNo} 场 · ${scene.heading}`,
          `- 时间：${scene.timeLabel ?? '—'} · 地点：${scene.locationLabel ?? '—'}`,
          `- 角色：${((scene.characters ?? []) as string[]).join('、') || '—'}`,
          `- 目标：${scene.objective} · 冲突：${scene.conflict}`,
          `- 情绪弧线：${scene.emotionalArc}`,
          '',
        );
      }
      zip.file(`${dir}/scenes.md`, sceneLines.join('\n'));

      const boardLines = [`# 第 ${episode.episodeNo} 集 · 分镜`, ''];
      const promptsJson: Record<string, unknown>[] = [];
      for (const scene of scenes) {
        boardLines.push(`## 第 ${scene.sceneNo} 场 · ${scene.heading}`, '');
        for (const shot of scene.shots) {
          const payload = shot.payload as Record<string, string>;
          boardLines.push(
            `### 场${scene.sceneNo} · 镜${shot.sequence} [${shot.status}]`,
            `- 景别：${payload.shotSize ?? '—'} · 运镜：${payload.cameraMove ?? '—'} · 构图：${payload.composition ?? '—'}`,
            `- 光线：${payload.lighting ?? '—'} · 情绪：${payload.emotion ?? '—'}`,
            `- 画面：${payload.imagePrompt ?? '—'}`,
            '',
          );
          const imagePrompt = shot.prompts.filter((p) => p.kind === 'image').at(-1);
          const videoPrompt = shot.prompts.filter((p) => p.kind === 'video').at(-1);
          promptsJson.push({
            sceneNo: scene.sceneNo, sequence: shot.sequence, status: shot.status,
            imagePrompt: imagePrompt?.content ?? null, videoPrompt: videoPrompt?.content ?? null,
            imageVersion: imagePrompt?.version ?? null, videoVersion: videoPrompt?.version ?? null,
          });
        }
      }
      zip.file(`${dir}/storyboard.md`, boardLines.join('\n'));
      zip.file(`${dir}/prompts.json`, JSON.stringify(promptsJson, null, 2));

      const episodeManifest = {
        episodeNo: episode.episodeNo,
        status: episode.status,
        shotTarget: episode.shotTarget,
        sceneCount: scenes.length,
        shotCount: scenes.reduce((sum, scene) => sum + scene.shots.length, 0),
        ignoredIssues: issues.filter((issue) => issue.status === 'ignored').map((issue) => ({
          kind: issue.kind, issue: issue.issue, targetId: issue.targetId, ignoredAt: issue.ignoredAt?.toISOString(),
        })),
        resolvedIssues: issues.filter((issue) => issue.status === 'resolved').length,
        generatedAt,
      };
      zip.file(`${dir}/manifest.json`, JSON.stringify(episodeManifest, null, 2));
      episodeManifests.push(episodeManifest);
    }

    const manifest = {
      schemaVersion: 1,
      project: { id: project.id, name: project.name },
      generatedAt,
      episodeCount: project.episodes.length,
      episodes: episodeManifests,
      projectAssetCount: project.assets.length,
      fileCount: 1 + project.episodes.length * 5 + 1,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const fileName = `${project.name}-${generatedAt.slice(0, 10)}.zip`;

    const root = process.env.EXPORT_ROOT ?? '/tmp/sd-exports';
    const dir = join(root, projectId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, fileName);
    writeFileSync(path, buffer);
    await this.prisma.projectExport.create({
      data: { projectId, fileName, path, manifest: manifest as object },
    });
    await this.events.append(projectId, 'artifact_created', { artifact: 'export', fileName, fileCount: manifest.fileCount });
    return { fileName, buffer, manifest };
  }
}
