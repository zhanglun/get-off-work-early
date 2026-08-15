import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { TaskCenterService } from '../task-center/task-center.service';
import { StoreService } from '../prisma/store.service';
import { EpisodeProcessor } from '../processor/episode.processor';
import { ScoreSubmitSchema } from '../core/types';

// DTO 契约（zod 即文档）——队友 A 的盲测打分页只依赖本文件 + 本 controller 路由
const CreateTaskDto = z.object({
  scriptText: z.string().min(10, '剧本太短'),
  episodeNo: z.number().int().optional(),
  config: z
    .object({ maxRounds: z.number().int().min(1).max(5).optional(), concurrency: z.number().int().min(1).max(8).optional() })
    .optional(),
});

@Controller()
export class TasksController {
  // 盲测侧序缓存：taskCenterId -> sideOrder（同一任务所有打分者看到相同随机顺序）
  private sideOrders = new Map<string, 'left:new' | 'left:old'>();

  constructor(
    private readonly taskCenter: TaskCenterService,
    private readonly store: StoreService,
    private readonly processor: EpisodeProcessor,
  ) {}

  @Post('tasks')
  async createTask(@Body() body: unknown) {
    const dto = CreateTaskDto.safeParse(body);
    if (!dto.success) throw new HttpException(dto.error.issues, 400);
    const taskCenterId = await this.taskCenter.createTask({
      scriptText: dto.data.scriptText,
      episodeNo: dto.data.episodeNo,
      config: dto.data.config ?? {},
    });
    await this.processor.enqueue(taskCenterId);
    return { taskId: taskCenterId, status: 'queued' };
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string) {
    const s = await this.taskCenter.getStatus(id);
    const shots = await this.store.listShots(id);
    return {
      ...s,
      needsReview: shots.filter((x) => x.status === 'needs_review').length,
      failed: shots.filter((x) => x.status === 'failed').length,
      tokensUsed: shots.reduce((a, x) => a + x.tokensUsed, 0),
    };
  }

  @Get('tasks/:id/shots')
  async listShots(@Param('id') id: string) {
    const shots = await this.store.listShots(id);
    return shots.map((s) => ({
      seq: s.seq,
      sceneNo: s.sceneNo,
      status: s.status,
      durationSec: s.durationSec,
      scriptExcerpt: s.scriptExcerpt,
      draft: s.draft,
      finalPrompt: s.finalPrompt,
      rationale: s.rationale,
      iterations: s.iterations,
      tokensUsed: s.tokensUsed,
      reviews: s.reviews.map((r) => ({
        round: r.round,
        passed: r.passed,
        findings: r.findings,
        changes: r.changes,
      })),
    }));
  }

  @Get('tasks/:id/pairs')
  async getPairs(@Param('id') id: string) {
    const [shots, olds] = await Promise.all([
      this.store.listShots(id),
      this.store.listOldShots(id),
    ]);
    const oldMap = new Map(olds.map((o) => [o.seq, o]));
    // 侧序随任务缓存（盲测公平性：随机 + 同任务稳定）
    if (!this.sideOrders.has(id)) {
      this.sideOrders.set(id, Math.random() < 0.5 ? 'left:new' : 'left:old');
    }
    const sideOrder = this.sideOrders.get(id)!;
    return shots.map((s) => {
      const old = oldMap.get(s.seq);
      const newPrompt = s.finalPrompt ?? '';
      const oldPrompt = old?.legacyPrompt ?? '';
      return {
        shotId: s.id,
        seq: s.seq,
        scriptExcerpt: s.scriptExcerpt,
        status: s.status,
        sideA: sideOrder === 'left:new' ? { origin: 'A', prompt: newPrompt } : { origin: 'A', prompt: oldPrompt },
        sideB: sideOrder === 'left:new' ? { origin: 'B', prompt: oldPrompt } : { origin: 'B', prompt: newPrompt },
      };
    });
  }

  @Post('scores')
  async submitScore(@Body() body: unknown) {
    const dto = ScoreSubmitSchema.safeParse(body);
    if (!dto.success) throw new HttpException(dto.error.issues, 400);
    const { shotId, rater, winner, scoreA, scoreB, sideOrder } = dto.data;
    // 按 sideOrder 归因：A/B 位置 → new/old
    const newIsLeft = sideOrder === 'left:new';
    const scoreNew = newIsLeft ? scoreA : scoreB;
    const scoreOld = newIsLeft ? scoreB : scoreA;
    const winnerResolved =
      (winner === 'A' && newIsLeft) || (winner === 'B' && !newIsLeft) ? 'new' : 'old';
    await this.store.addScore({ shotId, rater, winner: winnerResolved, scoreNew, scoreOld, sideOrder });
    return { ok: true };
  }

  @Get('tasks/:id/scores')
  async listScores(@Param('id') id: string) {
    const shots = await this.store.listShots(id);
    const scores = await this.store.listScores(shots.map((s) => s.id));
    const byShot = new Map<number, { winnerNew: number; total: number; scoreNewSum: number; scoreOldSum: number }>();
    for (const sc of scores) {
      const shot = shots.find((s) => s.id === sc.shotId);
      if (!shot) continue;
      const agg = byShot.get(shot.seq) ?? { winnerNew: 0, total: 0, scoreNewSum: 0, scoreOldSum: 0 };
      agg.total++;
      if (sc.winner === 'new') agg.winnerNew++;
      agg.scoreNewSum += sc.scoreNew;
      agg.scoreOldSum += sc.scoreOld;
      byShot.set(shot.seq, agg);
    }
    const rows = [...byShot.entries()].map(([seq, a]) => ({
      shotSeq: seq,
      votes: a.total,
      newWinRate: a.total ? +(a.winnerNew / a.total).toFixed(2) : 0,
      avgScoreNew: a.total ? +(a.scoreNewSum / a.total).toFixed(2) : 0,
      avgScoreOld: a.total ? +(a.scoreOldSum / a.total).toFixed(2) : 0,
    }));
    const totalVotes = rows.reduce((a, r) => a + r.votes, 0);
    return {
      perShot: rows,
      overall: {
        votes: totalVotes,
        newWinRate: totalVotes ? +(rows.reduce((a, r) => a + r.newWinRate * r.votes, 0) / totalVotes).toFixed(2) : 0,
      },
    };
  }
}
