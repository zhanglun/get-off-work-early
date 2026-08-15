import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

// 存储适配层：
// - mode=db    ：Prisma + PostgreSQL（公司/本地 compose 环境）
// - mode=mem   ：进程内降级（无 PG 环境跑通链路用——数据不持久）
// 接口保持与 Prisma client 相同的领域操作面，业务层无感。

interface ShotRow {
  id: string;
  taskCenterId: string;
  seq: number;
  sceneNo: number;
  scriptExcerpt: string;
  durationSec: number;
  status: string;
  draft: unknown | null;
  finalPrompt: string | null;
  rationale: string | null;
  iterations: number;
  tokensUsed: number;
}
interface OldShotRow {
  id: string;
  taskCenterId: string;
  seq: number;
  legacyPrompt: string;
  raw: unknown;
}
interface ReviewLogRow {
  id: string;
  shotId: string;
  round: number;
  passed: boolean;
  findings: unknown;
  changes: string | null;
}
interface ScoreRow {
  id: string;
  shotId: string;
  rater: string;
  winner: string;
  scoreNew: number;
  scoreOld: number;
  sideOrder: string;
}
interface CharacterRow {
  id: string;
  taskCenterId: string;
  name: string;
  canonical: string;
}

@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  mode: 'db' | 'mem' = process.env.STORE_MODE === 'mem' ? 'mem' : 'db';
  // PrismaClient 类型经 @prisma/client 生成；未生成时（无 DB 环境）以 loose 接口兜底
  private prisma: any = null;

  // ===== 内存实现存储 =====
  private shots = new Map<string, ShotRow>();
  private oldShots = new Map<string, OldShotRow>();
  private reviews = new Map<string, ReviewLogRow>();
  private scores = new Map<string, ScoreRow>();
  private characters = new Map<string, CharacterRow>();
  private ids = 0;
  private nid = () => `m${(++this.ids).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  async onModuleInit() {
    if (this.mode === 'db') {
      try {
        const mod = (await import('@prisma/client' as string)) as { PrismaClient: new (opts?: unknown) => any };
        const { PrismaClient } = mod;
        this.prisma = new PrismaClient();
        await (this.prisma as any).$queryRaw`SELECT 1`;
        console.log('[store] PostgreSQL 已连接');
      } catch (e) {
        console.warn(`[store] PG 不可达（${(e as Error).message.slice(0, 80)}），降级内存模式`);
        this.mode = 'mem';
        this.prisma = null;
      }
    }
    if (this.mode === 'mem') console.warn('[store] 内存模式：重启丢数据（仅开发/链路验证用）');
  }
  async onModuleDestroy() {
    await this.prisma?.$disconnect();
  }

  // ===== Shot =====
  async upsertShot(row: Omit<ShotRow, 'id'> & { id?: string }): Promise<ShotRow> {
    if (this.prisma) {
      return this.prisma.shot.upsert({
        where: { taskCenterId_seq: { taskCenterId: row.taskCenterId, seq: row.seq } },
        create: row as never,
        update: {
          status: row.status,
          draft: row.draft as never,
          finalPrompt: row.finalPrompt,
          rationale: row.rationale,
          iterations: row.iterations,
          tokensUsed: row.tokensUsed,
        },
      });
    }
    const existing = [...this.shots.values()].find(
      (s) => s.taskCenterId === row.taskCenterId && s.seq === row.seq,
    );
    if (existing) {
      Object.assign(existing, { ...row, id: existing.id });
      return existing;
    }
    const created: ShotRow = { ...(row as ShotRow), id: row.id ?? this.nid() };
    this.shots.set(created.id, created);
    return created;
  }

  async listShots(taskCenterId: string): Promise<(ShotRow & { reviews: ReviewLogRow[] })[]> {
    if (this.prisma) {
      const rows = await this.prisma.shot.findMany({
        where: { taskCenterId },
        orderBy: { seq: 'asc' },
        include: { reviews: { orderBy: { round: 'asc' } } },
      });
      return rows as unknown as (ShotRow & { reviews: ReviewLogRow[] })[];
    }
    const shotIds = new Set(
      [...this.shots.values()].filter((s) => s.taskCenterId === taskCenterId).map((s) => s.id),
    );
    return [...this.shots.values()]
      .filter((s) => shotIds.has(s.id))
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({ ...s, reviews: [...this.reviews.values()].filter((r) => r.shotId === s.id) }));
  }

  // ===== OldShot =====
  async saveOldShots(
    taskCenterId: string,
    rows: { seq: number; legacyPrompt: string; raw: unknown }[],
  ): Promise<void> {
    if (this.prisma) {
      await this.prisma.oldShot.deleteMany({ where: { taskCenterId } });
      await this.prisma.oldShot.createMany({
        data: rows.map((r) => ({ taskCenterId, seq: r.seq, legacyPrompt: r.legacyPrompt, raw: r.raw })) as never[],
      });
      return;
    }
    for (const [id, r] of this.oldShots) if (r.taskCenterId === taskCenterId) this.oldShots.delete(id);
    for (const r of rows) {
      const id = this.nid();
      this.oldShots.set(id, { id, taskCenterId, ...r });
    }
  }
  async listOldShots(taskCenterId: string): Promise<OldShotRow[]> {
    if (this.prisma) {
      return this.prisma.oldShot.findMany({ where: { taskCenterId }, orderBy: { seq: 'asc' } });
    }
    return [...this.oldShots.values()]
      .filter((o) => o.taskCenterId === taskCenterId)
      .sort((a, b) => a.seq - b.seq);
  }

  // ===== ReviewLog =====
  async addReview(row: Omit<ReviewLogRow, 'id'>): Promise<ReviewLogRow> {
    if (this.prisma) {
      return this.prisma.reviewLog.create({ data: row as never });
    }
    const created = { ...row, id: this.nid() };
    this.reviews.set(created.id, created);
    return created;
  }

  // ===== Score =====
  async addScore(row: Omit<ScoreRow, 'id'>): Promise<ScoreRow> {
    if (this.prisma) {
      return this.prisma.score.create({ data: row as never });
    }
    const created = { ...row, id: this.nid() };
    this.scores.set(created.id, created);
    return created;
  }
  async listScores(shotIds: string[]): Promise<ScoreRow[]> {
    if (this.prisma) {
      return this.prisma.score.findMany({ where: { shotId: { in: shotIds } } });
    }
    return [...this.scores.values()].filter((s) => shotIds.includes(s.shotId));
  }

  // ===== CharacterCard =====
  async saveCharacters(
    taskCenterId: string,
    rows: { name: string; canonical: string }[],
  ): Promise<void> {
    if (this.prisma) {
      await this.prisma.characterCard.deleteMany({ where: { taskCenterId } });
      await this.prisma.characterCard.createMany({
        data: rows.map((r) => ({ taskCenterId, name: r.name, canonical: r.canonical })) as never[],
      });
      return;
    }
    for (const [id, c] of this.characters)
      if (c.taskCenterId === taskCenterId) this.characters.delete(id);
    for (const r of rows) {
      const id = this.nid();
      this.characters.set(id, { id, taskCenterId, ...r });
    }
  }
  async listCharacters(taskCenterId: string): Promise<CharacterRow[]> {
    if (this.prisma) {
      return this.prisma.characterCard.findMany({ where: { taskCenterId } });
    }
    return [...this.characters.values()].filter((c) => c.taskCenterId === taskCenterId);
  }
}
