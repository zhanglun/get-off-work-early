import { Controller, Post, Param, Body, HttpCode, Inject, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { generateShot, reviewShot } from '../llm/agents.ts';
import type { ScenePlan } from '../llm/scene-schemas.ts';
import type { StoryBibleDraft } from '../../domain/story-schemas.ts';

const retrySchema = z.object({
  scope: z.object({ sceneNo: z.number().int().positive(), sequence: z.number().int().positive() }),
});

@Controller('api/episodes/:id/retry')
export class RetryController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /** 单镜重试：只重跑失败范围，成功结果保留，原位更新。 */
  @Post()
  @HttpCode(200)
  async retry(@Param('id') episodeId: string, @Body() body: unknown) {
    const input = retrySchema.parse(body);
    const scene = await this.prisma.scene.findFirst({
      where: { episodeId, sceneNo: input.scope.sceneNo },
      include: { shots: { where: { sequence: input.scope.sequence } } },
    });
    if (!scene) throw new BadRequestException('场次不存在');
    const beats = (scene.beats ?? []) as string[];
    const scenePlan: ScenePlan = {
      sceneNo: scene.sceneNo, heading: scene.heading,
      timeLabel: scene.timeLabel, locationLabel: scene.locationLabel,
      characters: (scene.characters ?? []) as string[],
      objective: scene.objective, conflict: scene.conflict,
      beats: beats.length ? beats : [scene.objective], emotionalArc: scene.emotionalArc,
      continuityNotes: (scene.continuityNotes ?? []) as string[],
    };
    const bibleRecord = await this.prisma.storyBible.findFirst({ where: { episodeId }, orderBy: { version: 'desc' } });
    const bible = (bibleRecord ? {
      summary: bibleRecord.summary, logline: bibleRecord.logline,
      characters: bibleRecord.characters, locations: bibleRecord.locations,
      props: bibleRecord.props, relationships: bibleRecord.relationships,
      timeline: bibleRecord.timeline,
      ambiguities: bibleRecord.ambiguities, conflicts: bibleRecord.conflicts,
    } : { characters: [], locations: [], props: [], relationships: [], timeline: [], ambiguities: [], conflicts: [], summary: '', logline: '' }) as unknown as StoryBibleDraft;

    const beat = scenePlan.beats[(input.scope.sequence - 1) % scenePlan.beats.length];
    const result = await generateShot(scenePlan, input.scope.sequence, beat, bible);
    let draft = result.value;
    const review = await reviewShot(scenePlan, bible, draft);
    if (!review.value.passed) {
      draft = { ...draft, videoPrompt: `${draft.videoPrompt} 动作完成后保持明确姿态。` };
    }
    const shot = scene.shots[0];
    if (shot) {
      const nextVersion = Math.floor((await this.prisma.promptVersion.count({ where: { shotId: shot.id } })) / 2) + 1;
      await this.prisma.$transaction([
        this.prisma.shot.update({ where: { id: shot.id }, data: { status: 'done', payload: draft as object } }),
        this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'image', version: nextVersion, content: draft.imagePrompt, rationale: '单镜重试', status: 'done' } }),
        this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'video', version: nextVersion, content: draft.videoPrompt, rationale: '单镜重试', status: 'done' } }),
        this.prisma.issue.updateMany({ where: { episodeId, targetType: 'shot', targetId: `${input.scope.sceneNo}:${input.scope.sequence}`, kind: 'failure', status: 'open' }, data: { status: 'resolved' } }),
      ]);
    } else {
      const created = await this.prisma.shot.create({
        data: { sceneId: scene.id, sequence: input.scope.sequence, status: 'done', payload: draft as object },
      });
      await this.prisma.promptVersion.create({ data: { shotId: created.id, kind: 'image', version: 1, content: draft.imagePrompt, rationale: '单镜重试', status: 'done' } });
      await this.prisma.promptVersion.create({ data: { shotId: created.id, kind: 'video', version: 1, content: draft.videoPrompt, rationale: '单镜重试', status: 'done' } });
    }
    await this.events.append((await this.prisma.episode.findUnique({ where: { id: episodeId } }))!.projectId, 'artifact_updated', {
      artifact: 'shot', sceneNo: input.scope.sceneNo, sequence: input.scope.sequence, change: 'retry', mock: result.mock,
    });
    return { ok: true, mock: result.mock };
  }
}
