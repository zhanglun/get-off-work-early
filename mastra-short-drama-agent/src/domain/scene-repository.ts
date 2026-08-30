import { PrismaClient, type Prisma } from '@prisma/client';
import type { ScenePlan } from './scene-schemas.ts';
import { storyRepository } from './story-repository.ts';

export interface ScenePlanRecord {
  episodeId: string;
  storyBibleId: string;
  status: 'awaiting_confirmation' | 'confirmed';
  scenes: ScenePlan[];
}

export interface SceneRepository {
  saveScenePlans(record: ScenePlanRecord): Promise<void>;
  getScenePlans(episodeId: string): Promise<ScenePlanRecord | null>;
  confirmScenePlans(episodeId: string): Promise<ScenePlanRecord>;
  close?(): Promise<void>;
}

export class MemorySceneRepository implements SceneRepository {
  private readonly records = new Map<string, ScenePlanRecord>();

  async saveScenePlans(record: ScenePlanRecord): Promise<void> {
    this.records.set(record.episodeId, record);
  }

  async getScenePlans(episodeId: string): Promise<ScenePlanRecord | null> {
    return this.records.get(episodeId) ?? null;
  }

  async confirmScenePlans(episodeId: string): Promise<ScenePlanRecord> {
    const record = await this.getScenePlans(episodeId);
    if (!record) throw new Error(`Scene 规划不存在: ${episodeId}`);
    record.status = 'confirmed';
    return record;
  }
}

export class PrismaSceneRepository implements SceneRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async saveScenePlans(record: ScenePlanRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const plan of record.scenes) {
        const scene = await tx.scene.upsert({
          where: {
            storyBibleId_sceneNo: {
              storyBibleId: record.storyBibleId,
              sceneNo: plan.sceneNo,
            },
          },
          create: {
            episodeId: record.episodeId,
            storyBibleId: record.storyBibleId,
            sceneNo: plan.sceneNo,
            heading: plan.heading,
            timeLabel: plan.timeLabel,
            locationLabel: plan.locationLabel,
            characters: plan.characters as Prisma.InputJsonValue,
            actions: [] as Prisma.InputJsonValue,
            dialogues: [] as Prisma.InputJsonValue,
            notes: [] as Prisma.InputJsonValue,
            rawText: '',
            objective: plan.objective,
            conflict: plan.conflict,
            beats: plan.beats as Prisma.InputJsonValue,
            emotionalArc: plan.emotionalArc,
            continuityNotes: plan.continuityNotes as Prisma.InputJsonValue,
            sourceRefs: plan.sourceRefs as Prisma.InputJsonValue,
            confidence: plan.confidence,
            planningStatus: record.status === 'confirmed' ? 'confirmed' : 'proposed',
          },
          update: {
            heading: plan.heading,
            timeLabel: plan.timeLabel,
            locationLabel: plan.locationLabel,
            characters: plan.characters as Prisma.InputJsonValue,
            objective: plan.objective,
            conflict: plan.conflict,
            beats: plan.beats as Prisma.InputJsonValue,
            emotionalArc: plan.emotionalArc,
            continuityNotes: plan.continuityNotes as Prisma.InputJsonValue,
            sourceRefs: plan.sourceRefs as Prisma.InputJsonValue,
            confidence: plan.confidence,
            planningStatus: record.status === 'confirmed' ? 'confirmed' : 'proposed',
          },
        });
        if (scene.storyBibleId !== record.storyBibleId) {
          await tx.scene.update({ where: { id: scene.id }, data: { storyBibleId: record.storyBibleId } });
        }
      }
    });
  }

  async getScenePlans(episodeId: string): Promise<ScenePlanRecord | null> {
    const currentBible = await this.prisma.storyBible.findFirst({ where: { episodeId }, orderBy: { version: 'desc' } });
    if (!currentBible) return null;
    const scenes = await this.prisma.scene.findMany({
      where: { episodeId, storyBibleId: currentBible.id },
      orderBy: { sceneNo: 'asc' },
    });
    if (scenes.length === 0 || scenes.every((scene) => !scene.objective)) return null;
    const first = scenes[0];
    return {
      episodeId,
      storyBibleId: first.storyBibleId,
      status: scenes.every((scene) => scene.planningStatus === 'confirmed') ? 'confirmed' : 'awaiting_confirmation',
      scenes: scenes.map((scene) => ({
        sceneNo: scene.sceneNo,
        heading: scene.heading,
        timeLabel: scene.timeLabel,
        locationLabel: scene.locationLabel,
        characters: scene.characters as string[],
        objective: scene.objective,
        conflict: scene.conflict,
        beats: (scene.beats ?? []) as string[],
        emotionalArc: scene.emotionalArc,
        continuityNotes: (scene.continuityNotes ?? []) as string[],
        sourceRefs: (scene.sourceRefs ?? []) as { type: 'script' | 'user' | 'agent' | 'derived' | 'imported-legacy'; ref: string }[],
        confidence: scene.confidence,
      })),
    };
  }

  async confirmScenePlans(episodeId: string): Promise<ScenePlanRecord> {
    const current = await this.getScenePlans(episodeId);
    if (!current) throw new Error(`Scene 规划不存在: ${episodeId}`);
    await this.prisma.scene.updateMany({ where: { episodeId, storyBibleId: current.storyBibleId }, data: { planningStatus: 'confirmed' } });
    const result = await this.getScenePlans(episodeId);
    if (!result) throw new Error(`确认后无法读取 Scene 规划: ${episodeId}`);
    return result;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
    await storyRepository.close?.();
  }
}

export const sceneRepository: SceneRepository = process.env.STORAGE_MODE === 'postgres'
  ? new PrismaSceneRepository()
  : new MemorySceneRepository();
