import { PrismaClient, type Prisma } from '@prisma/client';
import { assertStoryBibleConfirmable } from './story-confirmation.ts';
import type { StoryUnderstandingResult } from './story-schemas.ts';
import { storyboardStore } from './store.ts';

export interface StoryUnderstandingRecord extends StoryUnderstandingResult {
  projectName: string;
  episodeNo: number;
  scriptText: string;
}

export interface StoryRepository {
  saveStoryUnderstanding(record: StoryUnderstandingRecord): Promise<void>;
  getStoryUnderstanding(episodeId: string): Promise<StoryUnderstandingRecord | null>;
  confirmStoryBible(episodeId: string): Promise<StoryUnderstandingRecord>;
  close?(): Promise<void>;
}

export class MemoryStoryRepository implements StoryRepository {
  async saveStoryUnderstanding(record: StoryUnderstandingRecord): Promise<void> {
    storyboardStore.saveStoryUnderstanding(record);
  }

  async getStoryUnderstanding(episodeId: string): Promise<StoryUnderstandingRecord | null> {
    try {
      return storyboardStore.getStoryUnderstanding(episodeId) as StoryUnderstandingRecord;
    } catch {
      return null;
    }
  }

  async confirmStoryBible(episodeId: string): Promise<StoryUnderstandingRecord> {
    const current = await this.getStoryUnderstanding(episodeId);
    if (!current) throw new Error(`StoryBible 不存在: ${episodeId}`);
    assertStoryBibleConfirmable(current.storyBible);
    return storyboardStore.confirmStoryBible(episodeId) as StoryUnderstandingRecord;
  }
}

export class PrismaStoryRepository implements StoryRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async saveStoryUnderstanding(record: StoryUnderstandingRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.project.upsert({
        where: { id: record.projectId },
        create: { id: record.projectId, name: record.projectName },
        update: { name: record.projectName },
      });

      const episode = await tx.episode.upsert({
        where: {
          projectId_episodeNo: {
            projectId: record.projectId,
            episodeNo: record.episodeNo,
          },
        },
        create: {
          id: record.episodeId,
          projectId: record.projectId,
          episodeNo: record.episodeNo,
          status: record.status,
        },
        update: { status: record.status },
      });

      const latestScript = await tx.scriptVersion.findFirst({ where: { episodeId: episode.id }, orderBy: { version: 'desc' } });
      const scriptVersion = await tx.scriptVersion.create({
        data: {
          id: record.scriptVersionId,
          episodeId: episode.id,
          version: (latestScript?.version ?? 0) + 1,
          format: record.parsedScript.format,
          content: record.scriptText,
        },
      });
      const latestBible = await tx.storyBible.findFirst({ where: { episodeId: episode.id }, orderBy: { version: 'desc' } });
      await tx.storyBible.updateMany({ where: { episodeId: episode.id, status: { not: 'superseded' } }, data: { status: 'superseded' } });

      await tx.storyBible.create({
        data: {
          version: (latestBible?.version ?? 0) + 1,
          id: record.storyBibleId,
          episodeId: episode.id,
          scriptVersionId: scriptVersion.id,
          status: record.status === 'confirmed' ? 'confirmed' : 'proposed',
          summary: record.storyBible.summary,
          logline: record.storyBible.logline,
          characters: record.storyBible.characters as Prisma.InputJsonValue,
          locations: record.storyBible.locations as Prisma.InputJsonValue,
          props: record.storyBible.props as Prisma.InputJsonValue,
          relationships: record.storyBible.relationships as Prisma.InputJsonValue,
          timeline: record.storyBible.timeline as Prisma.InputJsonValue,
          ambiguities: record.storyBible.ambiguities as Prisma.InputJsonValue,
          conflicts: record.storyBible.conflicts as Prisma.InputJsonValue,
          characterRecords: {
            create: record.storyBible.characters.map((character) => ({
              name: character.name,
              aliases: character.aliases as Prisma.InputJsonValue,
              age: character.age,
              appearance: character.appearance,
              clothing: character.clothing,
              personality: character.personality,
              speakingStyle: character.speakingStyle,
              canonicalDescription: character.canonicalDescription,
              sourceRefs: character.sourceRefs as Prisma.InputJsonValue,
              confidence: character.confidence,
              status: 'proposed',
              version: 1,
            })),
          },
          locationRecords: {
            create: record.storyBible.locations.map((location) => ({
              name: location.name,
              layout: location.layout,
              lighting: location.lighting,
              colorStyle: location.colorStyle,
              fixedProps: location.fixedProps as Prisma.InputJsonValue,
              spatialConstraints: location.spatialConstraints as Prisma.InputJsonValue,
              sourceRefs: location.sourceRefs as Prisma.InputJsonValue,
              confidence: location.confidence,
              status: 'proposed',
              version: 1,
            })),
          },
          propRecords: {
            create: record.storyBible.props.map((prop) => ({
              name: prop.name,
              appearance: prop.appearance,
              owner: prop.owner,
              continuityRules: prop.continuityRules as Prisma.InputJsonValue,
              sourceRefs: prop.sourceRefs as Prisma.InputJsonValue,
              confidence: prop.confidence,
              status: 'proposed',
              version: 1,
            })),
          },
          relationshipRecords: {
            create: record.storyBible.relationships.map((relationship) => ({
              fromEntity: relationship.from,
              toEntity: relationship.to,
              type: relationship.type,
              description: relationship.description,
              sourceRefs: relationship.sourceRefs as Prisma.InputJsonValue,
              version: 1,
            })),
          },
          timelineEvents: {
            create: record.storyBible.timeline.map((event) => ({
              sceneNo: event.sceneNo,
              sequence: event.sequence,
              timeLabel: event.timeLabel,
              participants: event.participants as Prisma.InputJsonValue,
              action: event.action,
              emotionalChange: event.emotionalChange,
              dramaticPurpose: event.dramaticPurpose,
              sourceRefs: event.sourceRefs as Prisma.InputJsonValue,
              version: 1,
            })),
          },
          scenes: {
            create: record.parsedScript.scenes.map((scene) => ({
              sceneNo: scene.sceneNo,
              heading: scene.heading,
              timeLabel: scene.timeLabel,
              locationLabel: scene.locationLabel,
              characters: scene.characters as Prisma.InputJsonValue,
              actions: scene.actions as Prisma.InputJsonValue,
              dialogues: scene.dialogues as Prisma.InputJsonValue,
              notes: scene.notes as Prisma.InputJsonValue,
              rawText: scene.rawText,
              objective: '',
              conflict: '',
              beats: [] as Prisma.InputJsonValue,
              emotionalArc: '',
              continuityNotes: [] as Prisma.InputJsonValue,
              sourceRefs: [] as Prisma.InputJsonValue,
              confidence: 0,
              planningStatus: 'proposed',
              episodeId: episode.id,
            })),
          },
        },
      });
    });
  }

  async getStoryUnderstanding(episodeId: string): Promise<StoryUnderstandingRecord | null> {
    const row = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        project: true,
        scriptVersions: { orderBy: { version: 'desc' }, take: 1 },
        storyBibles: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { scenes: { orderBy: { sceneNo: 'asc' } } },
        },
      },
    });
    if (!row || row.storyBibles.length === 0 || row.scriptVersions.length === 0) return null;
    const bible = row.storyBibles[0];
    const script = row.scriptVersions[0];
    return {
      projectId: row.projectId,
      projectName: row.project.name,
      episodeId: row.id,
      episodeNo: row.episodeNo,
      scriptVersionId: script.id,
      storyBibleId: bible.id,
      scriptText: script.content,
      status: bible.status === 'confirmed' ? 'confirmed' : 'awaiting_confirmation',
      parsedScript: {
        format: script.format as 'basic-markdown' | 'industry-markdown' | 'unknown',
        title: null,
        scenes: bible.scenes.map((scene) => ({
          sceneNo: scene.sceneNo,
          heading: scene.heading,
          timeLabel: scene.timeLabel,
          locationLabel: scene.locationLabel,
          characters: scene.characters as string[],
          actions: scene.actions as string[],
          dialogues: scene.dialogues as string[],
          notes: scene.notes as string[],
          rawText: scene.rawText,
        })),
        warnings: [],
      },
      storyBible: {
        summary: bible.summary,
        logline: bible.logline,
        characters: bible.characters as never,
        locations: bible.locations as never,
        props: bible.props as never,
        relationships: bible.relationships as never,
        timeline: bible.timeline as never,
        ambiguities: bible.ambiguities as never,
        conflicts: bible.conflicts as never,
      },
    };
  }

  async confirmStoryBible(episodeId: string): Promise<StoryUnderstandingRecord> {
    const current = await this.getStoryUnderstanding(episodeId);
    if (!current) throw new Error(`StoryBible 不存在: ${episodeId}`);
    assertStoryBibleConfirmable(current.storyBible);
    const bible = await this.prisma.storyBible.findFirst({
      where: { episodeId },
      orderBy: { version: 'desc' },
    });
    if (!bible) throw new Error(`StoryBible 不存在: ${episodeId}`);
    await this.prisma.$transaction([
      this.prisma.storyBible.update({ where: { id: bible.id }, data: { status: 'confirmed' } }),
      this.prisma.character.updateMany({ where: { storyBibleId: bible.id }, data: { status: 'confirmed' } }),
      this.prisma.location.updateMany({ where: { storyBibleId: bible.id }, data: { status: 'confirmed' } }),
      this.prisma.prop.updateMany({ where: { storyBibleId: bible.id }, data: { status: 'confirmed' } }),
      this.prisma.episode.update({ where: { id: episodeId }, data: { status: 'story_bible_confirmed' } }),
    ]);
    const result = await this.getStoryUnderstanding(episodeId);
    if (!result) throw new Error(`确认后无法读取 StoryBible: ${episodeId}`);
    return result;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const storyRepository: StoryRepository = process.env.STORAGE_MODE === 'postgres'
  ? new PrismaStoryRepository()
  : new MemoryStoryRepository();
