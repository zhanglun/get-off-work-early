import { PrismaClient, type Prisma } from '@prisma/client';
import type { ChangeProposal, ShotProductionResult } from './production-schemas.ts';

export interface ProductionRepository {
  saveShots(episodeId: string, results: ShotProductionResult[]): Promise<void>;
  listShots(episodeId: string): Promise<ShotProductionResult[]>;
  listPromptVersions(episodeId: string, sceneNo: number, sequence: number): Promise<Array<{ kind: string; version: number; content: string; rationale: string | null }>>;
  createChangeProposal(proposal: ChangeProposal): Promise<void>;
  getChangeProposal(id: string): Promise<ChangeProposal | null>;
  decideChangeProposal(id: string, status: 'approved' | 'rejected'): Promise<ChangeProposal>;
  saveFeedback(input: { targetType: string; targetId: string; rating?: number; action?: string; comment?: string; createdBy?: string }): Promise<void>;
  saveExport(input: { episodeId: string; version: number; format: string; includedAssets: unknown; content: string }): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryProductionRepository implements ProductionRepository {
  private readonly shots = new Map<string, ShotProductionResult[]>();
  private readonly proposals = new Map<string, ChangeProposal>();
  private readonly exports = new Map<string, { episodeId: string; version: number; format: string; includedAssets: unknown; content: string }>();

  async saveShots(episodeId: string, results: ShotProductionResult[]): Promise<void> {
    const existing = this.shots.get(episodeId) ?? [];
    const merged = [...existing.filter((old) => !results.some((next) => next.sceneNo === old.sceneNo && next.sequence === old.sequence)), ...results];
    merged.sort((a, b) => a.sceneNo - b.sceneNo || a.sequence - b.sequence);
    this.shots.set(episodeId, merged);
  }
  async listShots(episodeId: string): Promise<ShotProductionResult[]> {
    return this.shots.get(episodeId) ?? [];
  }
  async listPromptVersions(episodeId: string, sceneNo: number, sequence: number): Promise<Array<{ kind: string; version: number; content: string; rationale: string | null }>> {
    const shot = (await this.listShots(episodeId)).find((item) => item.sceneNo === sceneNo && item.sequence === sequence);
    return shot?.promptVersions ?? [];
  }
  async createChangeProposal(proposal: ChangeProposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
  }
  async getChangeProposal(id: string): Promise<ChangeProposal | null> {
    return this.proposals.get(id) ?? null;
  }
  async decideChangeProposal(id: string, status: 'approved' | 'rejected'): Promise<ChangeProposal> {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error(`变更提议不存在: ${id}`);
    proposal.status = status;
    return proposal;
  }
  async saveFeedback(_input: { targetType: string; targetId: string; rating?: number; action?: string; comment?: string; createdBy?: string }): Promise<void> {
    // Memory 模式只用于本地流程验证；反馈由进程生命周期承载。
  }
  async saveExport(input: { episodeId: string; version: number; format: string; includedAssets: unknown; content: string }): Promise<void> {
    this.exports.set(`${input.episodeId}:${input.version}:${input.format}`, input);
  }
}

export class PrismaProductionRepository implements ProductionRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async saveShots(episodeId: string, results: ShotProductionResult[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const currentBible = await tx.storyBible.findFirst({ where: { episodeId }, orderBy: { version: 'desc' } });
      if (!currentBible) throw new Error(`StoryBible 不存在: ${episodeId}`);
      const scenes = await tx.scene.findMany({ where: { episodeId, storyBibleId: currentBible.id } });
      const sceneByNo = new Map(scenes.map((scene) => [scene.sceneNo, scene]));
      for (const result of results) {
        const scene = sceneByNo.get(result.sceneNo);
        if (!scene) throw new Error(`Scene 不存在: ${episodeId}/${result.sceneNo}`);
        const shot = await tx.shot.upsert({
          where: { sceneId_sequence: { sceneId: scene.id, sequence: result.sequence } },
          create: {
            sceneId: scene.id,
            sequence: result.sequence,
            status: result.status,
            payload: (result.draft ?? {}) as unknown as Prisma.InputJsonValue,
          },
          update: { status: result.status, payload: (result.draft ?? {}) as unknown as Prisma.InputJsonValue },
        });
        for (const prompt of result.promptVersions) {
          const previous = await tx.promptVersion.findFirst({
            where: { shotId: shot.id, kind: prompt.kind },
            orderBy: { version: 'desc' },
          });
          await tx.promptVersion.create({
            data: {
              shotId: shot.id,
              kind: prompt.kind,
              version: (previous?.version ?? 0) + 1,
              content: prompt.content,
              rationale: prompt.rationale,
              model: process.env.LLM_MODEL ?? 'mock',
              sourceType: 'agent',
              sourceRef: `scene:${result.sceneNo}/shot:${result.sequence}`,
              status: result.status === 'done' ? 'reviewed' : 'needs_review',
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              latencyMs: result.latencyMs,
              basedOnId: previous?.id,
            },
          });
        }
        await tx.review.createMany({
          data: result.reviews.map((review) => ({
            shotId: shot.id,
            targetType: 'shot',
            targetId: shot.id,
            reviewerType: 'agent',
            round: review.round,
            passed: review.passed,
            confidence: review.confidence,
            findings: review.findings as unknown as Prisma.InputJsonValue,
            changes: review.changes,
            model: process.env.LLM_MODEL ?? 'mock',
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.latencyMs,
          })) as never[],
        });
      }
    });
  }

  async listShots(episodeId: string): Promise<ShotProductionResult[]> {
    const currentBible = await this.prisma.storyBible.findFirst({ where: { episodeId }, orderBy: { version: 'desc' } });
    if (!currentBible) return [];
    const rows = await this.prisma.shot.findMany({
      where: { scene: { episodeId, storyBibleId: currentBible.id } },
      include: { scene: true, prompts: { orderBy: [{ kind: 'asc' }, { version: 'asc' }] }, reviews: { orderBy: { round: 'asc' } } },
      orderBy: [{ scene: { sceneNo: 'asc' } }, { sequence: 'asc' }],
    });
    return rows.map((row) => {
      const draft = row.payload as any;
      return {
        sceneNo: row.scene.sceneNo,
        sequence: row.sequence,
        status: row.status as 'done' | 'needs_review' | 'failed',
        draft,
        promptVersions: row.prompts.map((prompt) => ({ kind: prompt.kind as 'image' | 'video', version: prompt.version, content: prompt.content, rationale: prompt.rationale ?? '' })),
        reviews: row.reviews.map((review) => ({ round: review.round, passed: review.passed, confidence: review.confidence ?? 0, findings: review.findings as any, changes: review.changes })),
        iterations: row.reviews.length,
        inputTokens: row.prompts.reduce((sum, prompt) => sum + prompt.inputTokens, 0),
        outputTokens: row.prompts.reduce((sum, prompt) => sum + prompt.outputTokens, 0),
        latencyMs: row.prompts.reduce((max, prompt) => Math.max(max, prompt.latencyMs), 0),
      };
    });
  }

  async listPromptVersions(episodeId: string, sceneNo: number, sequence: number): Promise<Array<{ kind: string; version: number; content: string; rationale: string | null }>> {
    const currentBible = await this.prisma.storyBible.findFirst({ where: { episodeId }, orderBy: { version: 'desc' } });
    if (!currentBible) return [];
    const rows = await this.prisma.promptVersion.findMany({
      where: { shot: { scene: { episodeId, sceneNo, storyBibleId: currentBible.id }, sequence } },
      orderBy: [{ kind: 'asc' }, { version: 'asc' }],
    });
    return rows.map((row) => ({ kind: row.kind, version: row.version, content: row.content, rationale: row.rationale }));
  }

  async createChangeProposal(proposal: ChangeProposal): Promise<void> {
    await this.prisma.changeProposal.create({
      data: {
        id: proposal.id,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        changeType: proposal.changeType,
        riskLevel: proposal.riskLevel,
        before: proposal.before as Prisma.InputJsonValue,
        after: proposal.after as Prisma.InputJsonValue,
        reason: proposal.reason,
        impactScope: proposal.impactScope as Prisma.InputJsonValue,
        status: proposal.status,
      },
    });
  }

  async getChangeProposal(id: string): Promise<ChangeProposal | null> {
    const row = await this.prisma.changeProposal.findUnique({ where: { id } });
    if (!row) return null;
    return { id: row.id, targetType: row.targetType as ChangeProposal['targetType'], targetId: row.targetId, changeType: row.changeType, riskLevel: row.riskLevel as ChangeProposal['riskLevel'], before: row.before, after: row.after, reason: row.reason, impactScope: row.impactScope as string[], status: row.status as ChangeProposal['status'] };
  }

  async decideChangeProposal(id: string, status: 'approved' | 'rejected'): Promise<ChangeProposal> {
    const row = await this.prisma.changeProposal.update({ where: { id }, data: { status, decidedAt: new Date() } });
    const result = await this.getChangeProposal(row.id);
    if (!result) throw new Error(`变更提议不存在: ${id}`);
    return result;
  }

  async saveFeedback(input: { targetType: string; targetId: string; rating?: number; action?: string; comment?: string; createdBy?: string }): Promise<void> {
    await this.prisma.feedback.create({ data: input });
  }

  async saveExport(input: { episodeId: string; version: number; format: string; includedAssets: unknown; content: string }): Promise<void> {
    await this.prisma.exportPackage.upsert({
      where: { episodeId_version_format: { episodeId: input.episodeId, version: input.version, format: input.format } },
      create: { episodeId: input.episodeId, version: input.version, format: input.format, includedAssets: input.includedAssets as Prisma.InputJsonValue, content: input.content },
      update: { includedAssets: input.includedAssets as Prisma.InputJsonValue, content: input.content },
    });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const productionRepository: ProductionRepository = process.env.STORAGE_MODE === 'postgres'
  ? new PrismaProductionRepository()
  : new MemoryProductionRepository();
