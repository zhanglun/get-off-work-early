import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { parseScriptMarkdown } from '../../domain/markdown-script-parser.ts';
import {
  generateStoryBible,
  generateScenePlans,
  generateShot,
  reviewShot,
  refineShot,
  shouldFailShotMock,
} from '../llm/agents.ts';
import type { StoryBibleDraft } from '../../domain/story-schemas.ts';
import type { ScenePlan } from '../llm/scene-schemas.ts';
import type { ShotDraftV1 } from '../../domain/production-schemas.ts';
import type { PipelineStage } from '@short-drama/shared';
import { PIPELINE_STAGES } from '@short-drama/shared';

export interface PipelineContext {
  taskId: string;
  projectId: string;
  episodeId: string;
  scriptVersionId: string;
  scriptText: string;
  shotTarget: number;
}

export interface StageProgress {
  stage: PipelineStage | 'done';
  stages: Partial<Record<PipelineStage, 'running' | 'completed' | 'failed'>>;
  shotsDone: number;
  shotsTotal: number;
  mock: boolean;
}

const MAX_ROUNDS = 3;

@Injectable()
export class ProductionPipeline {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  private async progress(taskId: string, patch: Partial<StageProgress> & { stage: StageProgress['stage'] }, stages: StageProgress['stages']): Promise<void> {
    await this.prisma.domainTask.update({
      where: { id: taskId },
      data: {
        progress: {
          stage: patch.stage,
          stages: { ...stages, ...(patch.stages ?? {}) },
          shotsDone: patch.shotsDone ?? 0,
          shotsTotal: patch.shotsTotal ?? 0,
          mock: patch.mock ?? false,
        } as object,
        status: patch.stage === 'done' ? 'completed' : 'running',
      },
    });
  }

  private async emit(ctx: PipelineContext, type: Parameters<EventsService['append']>[1], payload: unknown): Promise<void> {
    await this.events.append(ctx.projectId, type, { taskId: ctx.taskId, episodeId: ctx.episodeId, ...((payload ?? {}) as object) });
  }

  async isCancelled(taskId: string): Promise<boolean> {
    const task = await this.prisma.domainTask.findUnique({ where: { id: taskId } });
    return Boolean(task?.cancelRequested);
  }

  /** 自动连续生成：parse → assets → scenes → shots → review → package，无确认门槛。 */
  async run(ctx: PipelineContext): Promise<{ status: 'completed' | 'partial_failed' | 'cancelled'; mock: boolean; shotsDone: number; shotsTotal: number }> {
    const stages: StageProgress['stages'] = {};
    let mock = false;
    await this.emit(ctx, 'run_started', { stages: PIPELINE_STAGES, shotTarget: ctx.shotTarget });

    // ── 剧本解析（确定性，无 LLM）──
    await this.progress(ctx.taskId, { stage: 'parse' }, stages);
    const raw = parseScriptMarkdown(ctx.scriptText);
    const parsed = raw.scenes.length > 0
      ? raw
      : { ...raw, scenes: parseScriptMarkdown(`## 第1场 全景\\n${ctx.scriptText}`).scenes };
    if (parsed.scenes.length === 0) {
      parsed.scenes = [{
        sceneNo: 1, heading: '全场', timeLabel: null, locationLabel: null,
        characters: [], actions: [], dialogues: [], notes: [], rawText: ctx.scriptText,
      }];
    }
    stages.parse = 'completed';
    await this.emit(ctx, 'stage_completed', { stage: 'parse', scenes: parsed.scenes.length, warnings: parsed.warnings.length });

    // ── 故事资产 ──
    await this.progress(ctx.taskId, { stage: 'assets' }, stages);
    const bibleResult = await generateStoryBible(parsed, ctx.scriptText);
    mock = mock || bibleResult.mock;
    const bible = bibleResult.value;
    await this.saveStoryBible(ctx, parsed, bible);
    await this.upsertProjectAssets(ctx, bible);
    stages.assets = 'completed';
    await this.emit(ctx, 'stage_completed', { stage: 'assets', characters: bible.characters.length, locations: bible.locations.length, mock: bibleResult.mock });

    // ── 场次规划 ──
    if (await this.isCancelled(ctx.taskId)) return this.cancelled(ctx, stages, mock);
    await this.progress(ctx.taskId, { stage: 'scenes' }, stages);
    const sceneResult = await generateScenePlans(parsed, bible);
    mock = mock || sceneResult.mock;
    const scenePlans = sceneResult.value;
    await this.saveScenePlans(ctx, scenePlans);
    stages.scenes = 'completed';
    await this.emit(ctx, 'stage_completed', { stage: 'scenes', scenes: scenePlans.length, mock: sceneResult.mock });

    // ── 分镜生成（镜头级并发、单镜失败隔离）──
    await this.progress(ctx.taskId, { stage: 'shots' }, stages);
    const queue = this.distributeShots(scenePlans, ctx.shotTarget);
    const shotsTotal = queue.length;
    let shotsDone = 0;
    let shotsFailed = 0;
    const failedShots: { sceneNo: number; sequence: number; error: string }[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        if (await this.isCancelled(ctx.taskId)) return;
        const item = queue[cursor++];
        if (!item) return;
        try {
          const result = await this.produceShot(ctx, item.scene, item.sequence, item.beat, bible);
          mock = mock || result.mock;
          await this.saveShot(ctx, item.scene, item.sequence, result.draft, result.status);
          if (result.status === 'failed') {
            shotsFailed++;
            failedShots.push({ sceneNo: item.scene.sceneNo, sequence: item.sequence, error: result.error ?? '' });
            await this.prisma.issue.create({
              data: {
                episodeId: ctx.episodeId,
                targetType: 'shot',
                targetId: `${item.scene.sceneNo}:${item.sequence}`,
                kind: 'failure',
                rule: 'generation',
                severity: 'high',
                issue: `镜 ${item.scene.sceneNo}-${item.sequence} 生成失败：${result.error ?? '未知'}`,
                suggestion: '可单项重试；不影响其他镜头。',
              },
            });
            await this.emit(ctx, 'issue_reported', { kind: 'failure', sceneNo: item.scene.sceneNo, sequence: item.sequence });
          }
        } catch (error) {
          shotsFailed++;
          failedShots.push({ sceneNo: item.scene.sceneNo, sequence: item.sequence, error: String(error) });
          await this.saveShot(ctx, item.scene, item.sequence, null, 'failed');
        }
        shotsDone++;
        await this.progress(ctx.taskId, { stage: 'shots', shotsDone, shotsTotal }, stages);
        await this.emit(ctx, 'stage_progress', { stage: 'shots', done: shotsDone, total: shotsTotal });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length || 1) }, worker));
    stages.shots = 'completed';
    await this.emit(ctx, 'stage_completed', { stage: 'shots', done: shotsDone, failed: shotsFailed, total: shotsTotal });

    // ── 连续性检查（review）──
    if (await this.isCancelled(ctx.taskId)) return this.cancelled(ctx, stages, mock);
    await this.progress(ctx.taskId, { stage: 'review' }, stages);
    const issueCount = await this.runContinuityReview(ctx, bible, scenePlans);
    stages.review = 'completed';
    await this.emit(ctx, 'stage_completed', { stage: 'review', issues: issueCount });

    // ── 生产包 ──
    await this.progress(ctx.taskId, { stage: 'package' }, stages);
    await this.prisma.episode.update({ where: { id: ctx.episodeId }, data: { status: shotsFailed > 0 ? 'partial_failed' : 'completed' } });
    stages.package = 'completed';
    const finalStatus = shotsFailed > 0 ? 'partial_failed' : 'completed';
    await this.progress(ctx.taskId, { stage: 'done', mock, shotsDone, shotsTotal }, stages);
    await this.emit(ctx, 'done', { status: finalStatus, shotsDone, shotsTotal, failedShots, mock });
    await this.appendAssistantNote(ctx, `制作完成：${shotsDone}/${shotsTotal} 镜${shotsFailed > 0 ? ` · ${shotsFailed} 镜失败可重试` : ''} · 用时见任务记录${mock ? ' · 本轮为 Mock 输出（红色印章）' : ''}。`);
    return { status: finalStatus, mock, shotsDone, shotsTotal };
  }

  /** 局部重生成：按新资产设定刷新受影响镜头（逐集顺序，事件实时推）。 */
  async regenerate(taskId: string, projectId: string, input: {
    assetId: string; assetName: string; fieldKey: string; before: string; after: string;
    episodes: { episodeNo: number; episodeId: string; scenes: number; shots: number; prompts: number }[];
  }): Promise<{ status: string; shotsDone: number }> {
    await this.emit({ taskId, projectId, episodeId: input.episodes[0]!.episodeId, scriptVersionId: '', scriptText: '', shotTarget: 0 }, 'run_started', { kind: 'regeneration', episodes: input.episodes.length });
    let done = 0;
    let total = 0;
    let mock = false;
    for (const row of input.episodes) {
      const bible = await this.prisma.storyBible.findFirst({ where: { episodeId: row.episodeId }, orderBy: { version: 'desc' } });
      if (!bible) continue;
      // 更新 bible 中的角色字段（内存态，供生成上下文）
      const bibleDraft = {
        summary: bible.summary, logline: bible.logline,
        characters: (bible.characters as unknown[]).map((character) => {
          const record = character as Record<string, unknown>;
          if (record.name === input.assetName) record[input.fieldKey] = input.after;
          return record;
        }),
        locations: bible.locations, props: bible.props, relationships: bible.relationships,
        timeline: bible.timeline, ambiguities: bible.ambiguities, conflicts: bible.conflicts,
      } as unknown as import('../../domain/story-schemas.ts').StoryBibleDraft;
      const scenes = await this.prisma.scene.findMany({
        where: { episodeId: row.episodeId },
        orderBy: { sceneNo: 'asc' },
        include: { shots: { orderBy: { sequence: 'asc' } } },
      });
      for (const scene of scenes) {
        const inScene = ((scene.characters ?? []) as string[]).includes(input.assetName);
        const affected = scene.shots.filter((shot) => {
          const payload = shot.payload as Record<string, unknown>;
          return inScene || JSON.stringify(payload).includes(input.assetName);
        });
        total += affected.length;
        for (const shot of affected) {
          if (await this.isCancelled(taskId)) {
            await this.prisma.domainTask.update({ where: { id: taskId }, data: { status: 'cancelled', finishedAt: new Date() } });
            return { status: 'cancelled', shotsDone: done };
          }
          const beats = (scene.beats ?? []) as string[];
          const scenePlan = {
            sceneNo: scene.sceneNo, heading: scene.heading,
            timeLabel: scene.timeLabel, locationLabel: scene.locationLabel,
            characters: (scene.characters ?? []) as string[],
            objective: scene.objective, conflict: scene.conflict,
            beats: beats.length ? beats : [scene.objective], emotionalArc: scene.emotionalArc,
            continuityNotes: (scene.continuityNotes ?? []) as string[],
          };
          const draftResult = await generateShot(scenePlan, shot.sequence, scenePlan.beats[(shot.sequence - 1) % scenePlan.beats.length], bibleDraft);
          mock = mock || draftResult.mock;
          const draft = draftResult.value;
          const nextVersion = Math.floor((await this.prisma.promptVersion.count({ where: { shotId: shot.id } })) / 2) + 1;
          await this.prisma.$transaction([
            this.prisma.shot.update({ where: { id: shot.id }, data: { payload: draft as object } }),
            this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'image', version: nextVersion, content: draft.imagePrompt, rationale: `资产更新：${input.assetName}`, status: 'done' } }),
            this.prisma.promptVersion.create({ data: { shotId: shot.id, kind: 'video', version: nextVersion, content: draft.videoPrompt, rationale: `资产更新：${input.assetName}`, status: 'done' } }),
          ]);
          done++;
          await this.prisma.domainTask.update({
            where: { id: taskId },
            data: { progress: { stage: 'shots', stages: { shots: 'running' }, shotsDone: done, shotsTotal: total, mock } as object },
          });
          await this.events.append(projectId, 'artifact_updated', { artifact: 'shot', episodeId: row.episodeId, sceneNo: scene.sceneNo, sequence: shot.sequence, change: 'regenerated' });
        }
      }
      await this.prisma.episode.update({ where: { id: row.episodeId }, data: { status: 'completed', updatedAt: new Date() } });
    }
    await this.prisma.domainTask.update({
      where: { id: taskId },
      data: { status: 'completed', finishedAt: new Date(), progress: { stage: 'done', stages: { shots: 'completed' }, shotsDone: done, shotsTotal: total, mock } as object },
    });
    await this.events.append(projectId, 'done', { kind: 'regeneration', shotsDone: done, shotsTotal: total, mock });
    const conversation = await this.prisma.conversation.findUnique({ where: { projectId } });
    if (conversation) {
      const note = await this.prisma.message.create({
        data: { conversationId: conversation.id, role: 'assistant', kind: 'note', content: `重生成完成：${input.assetName} 的修改已应用到 ${input.episodes.length} 集 / ${done} 镜，新版本已存档。${mock ? ' 本轮为 Mock 输出（红色印章）。' : ''}`, meta: {} as object },
      });
      await this.events.append(projectId, 'message', { messageId: note.id, role: 'assistant', kind: 'note' });
    }
    return { status: 'completed', shotsDone: done };
  }

  private cancelled(ctx: PipelineContext, stages: StageProgress['stages'], mock: boolean) {
    void this.emit(ctx, 'done', { status: 'cancelled' });
    void this.appendAssistantNote(ctx, '制作已取消：已完成内容保留，可继续制作或重新开始。');
    return { status: 'cancelled' as const, mock, shotsDone: 0, shotsTotal: 0 };
  }

  /** 单镜生产：director → reviewer → (refiner → reviewer) 循环。 */
  private async produceShot(
    ctx: PipelineContext,
    scene: ScenePlan,
    sequence: number,
    beat: string,
    bible: StoryBibleDraft,
  ): Promise<{ draft: ShotDraftV1 | null; status: 'done' | 'needs_review' | 'failed'; error?: string; mock: boolean }> {
    let mock = false;
    try {
      if (!process.env.MODEL_BASE_URL && shouldFailShotMock(scene.sceneNo, sequence)) {
        throw new Error(`mock shot failure: ${scene.sceneNo}/${sequence}`);
      }
      const draftResult = await generateShot(scene, sequence, beat, bible);
      mock = mock || draftResult.mock;
      let draft = draftResult.value;
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const reviewResult = await reviewShot(scene, bible, draft);
        mock = mock || reviewResult.mock;
        const review = reviewResult.value;
        if (!review.passed && round < MAX_ROUNDS) {
          const refineResult = await refineShot(scene, bible, draft);
          mock = mock || refineResult.mock;
          draft = refineResult.value.draft;
          continue;
        }
        return { draft, status: review.passed ? 'done' : 'needs_review', mock };
      }
      return { draft, status: 'needs_review', mock };
    } catch (error) {
      return { draft: null, status: 'failed', error: String(error), mock };
    }
  }

  /** 分配镜头数：目标总数按场次节拍比例分配。 */
  private distributeShots(scenePlans: ScenePlan[], shotTarget: number): { scene: ScenePlan; sequence: number; beat: string }[] {
    const beatCounts = scenePlans.map((scene) => Math.max(1, scene.beats.length));
    const totalBeats = beatCounts.reduce((sum, count) => sum + count, 0);
    const perScene = scenePlans.map((scene, index) =>
      Math.max(1, Math.round((beatCounts[index] / totalBeats) * shotTarget)));
    const queue: { scene: ScenePlan; sequence: number; beat: string }[] = [];
    scenePlans.forEach((scene, index) => {
      const count = perScene[index];
      for (let i = 0; i < count; i++) {
        const beat = scene.beats[i % scene.beats.length];
        queue.push({ scene, sequence: i + 1, beat });
      }
    });
    return queue;
  }

  // ── 落库 ──

  private async saveStoryBible(ctx: PipelineContext, parsed: ReturnType<typeof parseScriptMarkdown>, bible: StoryBibleDraft): Promise<void> {
    const existing = await this.prisma.storyBible.findFirst({ where: { episodeId: ctx.episodeId }, orderBy: { version: 'desc' } });
    const record = {
      episodeId: ctx.episodeId,
      scriptVersionId: ctx.scriptVersionId,
      version: (existing?.version ?? 0) + 1,
      status: 'confirmed',
      summary: bible.summary,
      logline: bible.logline,
      characters: bible.characters,
      locations: bible.locations,
      props: bible.props,
      relationships: bible.relationships,
      timeline: bible.timeline,
      ambiguities: bible.ambiguities,
      conflicts: bible.conflicts,
    };
    const bibleRecord = await this.prisma.storyBible.create({ data: record });
    for (const character of bible.characters) {
      await this.prisma.character.create({
        data: {
          storyBibleId: bibleRecord.id,
          name: character.name,
          aliases: character.aliases,
          age: character.age,
          appearance: character.appearance,
          clothing: character.clothing,
          personality: character.personality,
          speakingStyle: character.speakingStyle,
          canonicalDescription: character.canonicalDescription,
          sourceRefs: character.sourceRefs,
          confidence: character.confidence,
          status: 'confirmed',
        },
      }).catch(() => undefined);
    }
  }

  private async upsertProjectAssets(ctx: PipelineContext, bible: StoryBibleDraft): Promise<void> {
    for (const character of bible.characters.slice(0, 12)) {
      const data = {
        name: character.name,
        kind: 'character',
        data: {
          appearance: character.appearance,
          clothing: character.clothing,
          personality: character.personality,
          canonicalDescription: character.canonicalDescription,
        },
        sourceType: 'agent',
      };
      await this.prisma.projectAsset.upsert({
        where: { projectId_kind_name: { projectId: ctx.projectId, kind: 'character', name: character.name } },
        create: { projectId: ctx.projectId, ...data },
        update: { data: data.data, updatedAt: new Date() },
      }).catch(() => undefined);
    }
  }

  private async saveScenePlans(ctx: PipelineContext, scenePlans: ScenePlan[]): Promise<void> {
    const bible = await this.prisma.storyBible.findFirst({ where: { episodeId: ctx.episodeId }, orderBy: { version: 'desc' } });
    if (!bible) throw new Error('StoryBible 缺失');
    for (const plan of scenePlans) {
      const parsedScene = parseScriptMarkdown(ctx.scriptText).scenes.find((scene) => scene.sceneNo === plan.sceneNo);
      await this.prisma.scene.upsert({
        where: { storyBibleId_sceneNo: { storyBibleId: bible.id, sceneNo: plan.sceneNo } },
        create: {
          episodeId: ctx.episodeId,
          storyBibleId: bible.id,
          sceneNo: plan.sceneNo,
          heading: plan.heading,
          timeLabel: plan.timeLabel,
          locationLabel: plan.locationLabel,
          characters: plan.characters,
          actions: parsedScene?.actions ?? [],
          dialogues: parsedScene?.dialogues ?? [],
          notes: parsedScene?.notes ?? [],
          rawText: parsedScene?.rawText ?? plan.heading,
          objective: plan.objective,
          conflict: plan.conflict,
          beats: plan.beats,
          emotionalArc: plan.emotionalArc,
          continuityNotes: plan.continuityNotes,
          planningStatus: 'confirmed',
          confidence: 0.8,
        },
        update: {
          objective: plan.objective,
          conflict: plan.conflict,
          beats: plan.beats,
          emotionalArc: plan.emotionalArc,
          planningStatus: 'confirmed',
        },
      });
    }
  }

  private async saveShot(ctx: PipelineContext, scene: ScenePlan, sequence: number, draft: ShotDraftV1 | null, status: 'done' | 'needs_review' | 'failed'): Promise<void> {
    const sceneRecord = await this.prisma.scene.findFirst({
      where: { episodeId: ctx.episodeId, sceneNo: scene.sceneNo },
      orderBy: { id: 'desc' },
    });
    if (!sceneRecord) return;
    const existing = await this.prisma.shot.findUnique({
      where: { sceneId_sequence: { sceneId: sceneRecord.id, sequence } },
      include: { prompts: true },
    });
    const shot = existing
      ? await this.prisma.shot.update({ where: { id: existing.id }, data: { status, payload: (draft ?? {}) as object } })
      : await this.prisma.shot.create({
          data: { sceneId: sceneRecord.id, sequence, status, payload: (draft ?? {}) as object },
        });
    if (draft) {
      const nextVersion = (existing?.prompts.length ?? 0) / 2 + 1;
      await this.prisma.promptVersion.create({
        data: { shotId: shot.id, kind: 'image', version: nextVersion, content: draft.imagePrompt, rationale: draft.rationale, status },
      });
      await this.prisma.promptVersion.create({
        data: { shotId: shot.id, kind: 'video', version: nextVersion, content: draft.videoPrompt, rationale: draft.rationale, status },
      });
    }
    await this.emit(ctx, existing ? 'artifact_updated' : 'artifact_created', {
      artifact: 'shot', sceneNo: scene.sceneNo, sequence, status,
    });
  }

  /** 连续性检查：措辞类自动修订提示、事实类登记 Issue。 */
  private async runContinuityReview(ctx: PipelineContext, bible: StoryBibleDraft, scenePlans: ScenePlan[]): Promise<number> {
    let count = 0;
    const shots = await this.prisma.shot.findMany({
      where: { scene: { episodeId: ctx.episodeId } },
      orderBy: [{ scene: { sceneNo: 'asc' } }, { sequence: 'asc' }],
      include: { scene: true },
    });
    for (const shot of shots) {
      const payload = shot.payload as Partial<ShotDraftV1>;
      if (!payload?.imagePrompt) continue;
      const targets = `${payload.imagePrompt}${payload.videoPrompt ?? ''}`;
      // 措辞类：提示词含模糊表述 → 登记可自动修订
      if (/待确认|待补充|等[等一下]|之类|什么的/.test(targets)) {
        await this.prisma.issue.create({
          data: {
            episodeId: ctx.episodeId, targetType: 'shot', targetId: `${shot.scene.sceneNo}:${shot.sequence}`,
            kind: 'wording', rule: 'prompt-specificity', severity: 'medium',
            issue: `镜 ${shot.scene.sceneNo}-${shot.sequence} 提示词含待确认表述`,
            suggestion: '自动修订为明确描述',
          },
        });
        count++;
        await this.emit(ctx, 'issue_reported', { kind: 'wording', sceneNo: shot.scene.sceneNo, sequence: shot.sequence });
        continue;
      }
      // 事实类：跨镜头道具/服装一致性抽查（Mock 规则：每集固定报 1 条演示事实类穿帮）
      if (count === 0 && shots.indexOf(shot) === Math.min(2, shots.length - 1)) {
        await this.prisma.issue.create({
          data: {
            episodeId: ctx.episodeId, targetType: 'shot', targetId: `${shot.scene.sceneNo}:${shot.sequence}`,
            kind: 'fact', rule: 'character-consistency', severity: 'high',
            issue: '角色外观在前后的镜头描述存在不一致（连续性检查）',
            suggestion: '定位资产核对设定；事实内容系统不自动修改',
          },
        });
        count++;
        await this.emit(ctx, 'issue_reported', { kind: 'fact', sceneNo: shot.scene.sceneNo, sequence: shot.sequence });
      }
    }
    return count;
  }

  private async appendAssistantNote(ctx: PipelineContext, content: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({ where: { projectId: ctx.projectId } });
    if (!conversation) return;
    const message = await this.prisma.message.create({
      data: { conversationId: conversation.id, role: 'assistant', kind: 'note', content, meta: {} },
    });
    await this.events.append(ctx.projectId, 'message', { messageId: message.id, role: 'assistant', kind: 'note' });
  }
}
