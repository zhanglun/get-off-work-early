import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';

const LEASE_MS = 120_000;

@Injectable()
export class TaskLeaseService {
  private readonly workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 领取一个 queued 任务：行锁 + 租约；同项目存在 running 任务时跳过（项目互斥）。 */
  async claim(): Promise<{
    id: string; kind: string; projectId: string; episodeId: string;
    scriptVersionId: string; scriptText: string; shotTarget: number;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "DomainTask"
        WHERE status = 'queued'
          AND "cancelRequested" = false
          AND ("projectId" IS NULL OR "projectId" NOT IN (
            SELECT "projectId" FROM "DomainTask" WHERE status = 'running' AND "projectId" IS NOT NULL
          ))
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const candidate = candidates[0];
      if (!candidate) return null;
      const task = await tx.domainTask.update({
        where: { id: candidate.id },
        data: {
          status: 'running',
          leaseOwner: this.workerId,
          leaseUntil: new Date(Date.now() + LEASE_MS),
          startedAt: new Date(),
          attempts: { increment: 1 },
          error: null,
        },
      });
      if ((task.kind !== 'production' && task.kind !== 'regeneration') || !task.projectId || !task.episodeId || !task.inputRef) return null;
      const input = JSON.parse(task.inputRef) as {
        scriptVersionId: string; scriptText: string; shotTarget: number;
      };
      return {
        id: task.id, kind: task.kind,
        projectId: task.projectId, episodeId: task.episodeId,
        scriptVersionId: input.scriptVersionId,
        scriptText: input.scriptText,
        shotTarget: input.shotTarget,
        inputRef: task.inputRef,
      };
    });
  }

  async heartbeat(taskId: string): Promise<void> {
    await this.prisma.domainTask.update({
      where: { id: taskId },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
  }

  async finish(taskId: string, status: string, error?: string): Promise<void> {
    await this.prisma.domainTask.update({
      where: { id: taskId },
      data: { status, error: error ?? null, finishedAt: new Date(), leaseOwner: null, leaseUntil: null },
    });
  }

  /** 重启恢复：租约过期的 running 任务重新入队（保留已完成结果，由管线幂等续跑）。 */
  async requeueExpired(): Promise<number> {
    const result = await this.prisma.domainTask.updateMany({
      where: { status: 'running', leaseUntil: { lt: new Date() } },
      data: { status: 'queued', leaseOwner: null, leaseUntil: null },
    });
    return result.count;
  }
}
