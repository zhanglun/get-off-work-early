import { Controller, Post, Param, Body, HttpCode, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { refineShot } from '../llm/agents.ts';
import type { ShotDraftV1 } from '../../domain/production-schemas.ts';
import type { ScenePlan } from '../llm/scene-schemas.ts';
import type { StoryBibleDraft } from '../../domain/story-schemas.ts';

@Controller('api/issues')
export class IssuesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 忽略：不删除，导出 manifest 记录。 */
  @Post(':id/ignore')
  @HttpCode(200)
  async ignore(@Param('id') id: string) {
    const issue = await this.prisma.issue.update({
      where: { id },
      data: { status: 'ignored', ignoredAt: new Date() },
    });
    const episode = await this.prisma.episode.findUnique({ where: { id: issue.episodeId } });
    if (episode) {
      await this.events.append(episode.projectId, 'artifact_updated', { artifact: 'issue', issueId: id, status: 'ignored' });
    }
    return { ok: true };
  }

  /** 措辞类自动修订：只修措辞不改事实；产出新 Prompt 版本并记录 AssetVersion。 */
  @Post(':id/auto-fix')
  @HttpCode(200)
  async autoFix(@Param('id') id: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id } });
    if (!issue) throw new BadRequestException('穿帮不存在');
    if (issue.kind !== 'wording') throw new BadRequestException('仅措辞类可自动修订；事实类请定位资产后人工处理');
    const [sceneNoStr, seqStr] = issue.targetId.split(':');
    const sceneNo = Number(sceneNoStr);
    const sequence = Number(seqStr);
    const shot = await this.prisma.shot.findFirst({
      where: { scene: { episodeId: issue.episodeId, sceneNo }, sequence },
      include: { scene: true, prompts: true },
    });
    if (!shot) throw new BadRequestException('目标镜头不存在');
    const bible = await this.prisma.storyBible.findFirst({
      where: { episodeId: issue.episodeId },
      orderBy: { version: 'desc' },
    });
    const scenePlan: ScenePlan = {
      sceneNo, heading: shot.scene.heading,
      timeLabel: shot.scene.timeLabel, locationLabel: shot.scene.locationLabel,
      characters: (shot.scene.characters ?? []) as string[],
      objective: shot.scene.objective, conflict: shot.scene.conflict,
      beats: (shot.scene.beats ?? []) as string[], emotionalArc: shot.scene.emotionalArc,
      continuityNotes: (shot.scene.continuityNotes ?? []) as string[],
    };
    const before = shot.payload as Partial<ShotDraftV1>;
    const result = await refineShot(scenePlan, (bible ?? { characters: [], locations: [], props: [], relationships: [], timeline: [], ambiguities: [], conflicts: [], summary: '', logline: '' }) as unknown as StoryBibleDraft, before as ShotDraftV1);
    const nextVersion = Math.floor(shot.prompts.length / 2) + 1;
    await this.prisma.$transaction([
      this.prisma.shot.update({ where: { id: shot.id }, data: { payload: result.value.draft as object } }),
      this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'image', version: nextVersion, content: result.value.draft.imagePrompt, rationale: result.value.changes, status: 'auto_fixed' } }),
      this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'video', version: nextVersion, content: result.value.draft.videoPrompt, rationale: result.value.changes, status: 'auto_fixed' } }),
      this.prisma.issue.update({ where: { id }, data: { status: 'auto_fixed' } }),
    ]);
    await this.prisma.assetVersion.create({
      data: {
        targetType: 'prompt', targetId: shot.id, version: nextVersion,
        before: before as object, after: result.value.draft as object,
        reason: `措辞自动修订：${issue.issue}`, source: 'agent',
      },
    });
    await this.events.append(issue.episodeId, 'artifact_updated', { artifact: 'shot', sceneNo, sequence, change: 'auto_fix' });
    return { ok: true, changes: result.value.changes };
  }
}
