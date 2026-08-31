import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PipelineModule } from './nest/pipeline/pipeline.module.js';
import { ProductionPipeline } from './nest/pipeline/production-pipeline.js';
import { TaskLeaseService } from './nest/pipeline/task-lease.service.js';

process.on('unhandledRejection', (reason) => {
  console.error('[worker] 未处理 rejection:', reason);
});
process.on('exit', (code) => console.log(`[worker] 进程退出 code=${code}`));

interface ClaimedTask {
  id: string; kind: string; projectId: string; episodeId: string;
  scriptVersionId: string; scriptText: string; shotTarget: number;
  inputRef?: string;
}

function regenInputOf(task: ClaimedTask): {
  assetId: string; assetName: string; fieldKey: string; before: string; after: string;
  episodes: { episodeNo: number; episodeId: string; scenes: number; shots: number; prompts: number }[];
} {
  return JSON.parse(task.inputRef ?? '{}');
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(PipelineModule, { logger: ['error', 'warn'] });
  const lease = app.get(TaskLeaseService);
  const pipeline = app.get(ProductionPipeline);

  const requeued = await lease.requeueExpired();
  if (requeued > 0) console.log(`[worker] 恢复 ${requeued} 个租约过期任务`);

  console.log('[worker] 就绪，轮询任务…');
  let idleTicks = 0;
  const tick = async (): Promise<void> => {
    try {
      const task = await lease.claim();
      if (!task) {
        idleTicks++;
        setTimeout(() => void tick(), idleTicks < 2 ? 200 : 1500);
        return;
      }
      idleTicks = 0;
      console.log(`[worker] 领取任务 ${task.id}（${task.kind}，episode ${task.episodeId}${task.kind === 'production' ? `，目标 ${task.shotTarget} 镜` : ''}）`);
      const heartbeat = setInterval(() => void lease.heartbeat(task.id), 30_000);
      try {
        const result = task.kind === 'regeneration'
          ? await pipeline.regenerate(task.id, task.projectId, regenInputOf(task))
          : await pipeline.run({
              taskId: task.id,
              projectId: task.projectId,
              episodeId: task.episodeId,
              scriptVersionId: task.scriptVersionId,
              scriptText: task.scriptText,
              shotTarget: task.shotTarget,
            });
        await lease.finish(task.id, result.status === 'cancelled' ? 'cancelled' : result.status);
        console.log(`[worker] 任务完成 ${task.id}: ${result.status}（${result.shotsDone} 镜）`);
      } catch (error) {
        await lease.finish(task.id, 'failed', String(error));
        console.error(`[worker] 任务失败 ${task.id}:`, error);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      console.error('[worker] 轮询异常:', error);
    }
    if (idleTicks < 2) setTimeout(() => void tick(), 200);
    else setTimeout(() => void tick(), 1500);
  };
  void tick();

  const shutdown = async (): Promise<void> => {
    console.log('[worker] 退出');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void bootstrap();
