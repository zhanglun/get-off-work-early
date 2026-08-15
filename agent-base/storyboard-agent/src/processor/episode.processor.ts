import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import pLimit from 'p-limit';
import { TaskCenterService } from '../task-center/task-center.service';
import { StoreService } from '../prisma/store.service';
import { CoreService } from '../core/core.module';
import { ShotLoopService } from '../core/shot-loop';
import type { ShotContext } from '../core/shot-loop';
import { DefaultLoopConfig } from '../core/types';

// EpisodeProcessor：一集一个 job 的执行器。
// 队列层（BullMQ/Redis）不可达时降级为进程内即时执行——链路逻辑一致。
@Injectable()
export class EpisodeProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(EpisodeProcessor.name);
  private worker: { close(): Promise<void> } | null = null;
  // 内存降级：直接串行执行（测试/无 Redis 环境）
  constructor(
    private readonly taskCenter: TaskCenterService,
    private readonly store: StoreService,
    private readonly core: CoreService,
    private readonly shotLoop: ShotLoopService,
  ) {}

  async start() {
    if (process.env.QUEUE_MODE === 'bullmq') {
      const { Queue, Worker } = await import('bullmq');
      const IORedis = ((await import('ioredis')) as unknown as {
        default: new (url: string, opts?: unknown) => import('bullmq').ConnectionOptions;
      }).default;
      const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
        maxRetriesPerRequest: null,
      });
      const queue = new Queue('episode', { connection });
      this.worker = new Worker(
        'episode',
        async (job) => this.processEpisode(job.data.taskCenterId as string),
        { connection, concurrency: 2 },
      );
      this.queue = { add: (name: string, data: unknown) => queue.add(name, data) };
      this.logger.log('BullMQ worker 已启动（episode 队列）');
    } else {
      this.queue = {
        add: async (_name: string, data: unknown) => {
          const { taskCenterId } = data as { taskCenterId: string };
          // 内存模式：异步立即执行，不阻塞接口返回
          void this.processEpisode(taskCenterId).catch((e) =>
            this.logger.error(`[mem-queue] ${taskCenterId}: ${(e as Error).message}`),
          );
          return { id: `mem_${Date.now()}` } as never;
        },
      };
      this.logger.warn('队列内存模式（无 Redis 环境）——进程内执行');
    }
  }

  private queue!: { add(name: string, data: unknown): Promise<unknown> };

  async enqueue(taskCenterId: string) {
    await this.queue.add('episode', { taskCenterId });
  }

  // ===== 主流程（architecture.md §6 伪码的落地）=====
  async processEpisode(taskCenterId: string): Promise<void> {
    const input = await this.taskCenter.getTaskInput(taskCenterId);
    await this.taskCenter.updateStatus(taskCenterId, 'processing');

    // ① 旧切分导入
    let legacy;
    try {
      legacy = await this.retry(2, () => this.core.importLegacyShots(input.scriptText));
    } catch (e) {
      await this.taskCenter.updateStatus(taskCenterId, 'failed', `旧接口导入失败: ${(e as Error).message}`);
      return;
    }
    await this.store.saveOldShots(
      taskCenterId,
      legacy.shots.map((s) => ({ seq: s.seq, legacyPrompt: s.legacyPrompt, raw: s })),
    );

    // ② 轻量角色卡
    let characters: { name: string; canonical: string }[] = [];
    try {
      characters = await this.core.extractCharacters(input.scriptText);
      await this.store.saveCharacters(taskCenterId, characters);
    } catch (e) {
      this.logger.warn(`角色提取失败（继续，无角色卡）: ${(e as Error).message}`);
    }

    // ③ 每镜 loop（并发 P，单镜失败隔离）
    const config = { ...DefaultLoopConfig, ...(input.config ?? {}) };
    const limit = pLimit(config.concurrency);
    let done = 0;
    await Promise.all(
      legacy.shots.map((s, i) =>
        limit(async () => {
          const ctx: ShotContext = {
            ...s,
            characters,
            prevSummary: legacy.shots[i - 1]?.scriptExcerpt?.slice(0, 60),
            nextSummary: legacy.shots[i + 1]?.scriptExcerpt?.slice(0, 60),
          };
          const result = await this.shotLoop.run(ctx, config);
          const shotRow = await this.store.upsertShot({
            taskCenterId,
            seq: s.seq,
            sceneNo: s.sceneNo,
            scriptExcerpt: s.scriptExcerpt,
            durationSec: s.durationSec,
            status: result.status,
            draft: result.draft,
            finalPrompt: result.finalPrompt,
            rationale: result.rationale,
            iterations: result.iterations,
            tokensUsed: result.tokensUsed,
          });
          for (const rl of result.reviewLogs) {
            await this.store.addReview({ shotId: shotRow.id, ...rl });
          }
          done++;
          await this.taskCenter.reportProgress(taskCenterId, done, legacy.shots.length);
        }),
      ),
    );

    await this.taskCenter.updateStatus(taskCenterId, 'done');
    this.logger.log(`${taskCenterId} 完成：${legacy.shots.length} 镜`);
  }

  private async retry<T>(times: number, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= times; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
