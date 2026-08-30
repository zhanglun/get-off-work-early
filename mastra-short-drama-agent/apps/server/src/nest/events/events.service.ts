import { Injectable, Inject } from '@nestjs/common';
import type { EventType } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class EventsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 追加事件：projectId 内 seq 单调递增；先落库再推送。 */
  async append(projectId: string, type: EventType, payload: unknown): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.prisma.event.findFirst({
        where: { projectId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      try {
        const event = await this.prisma.event.create({
          data: { projectId, seq: (last?.seq ?? 0) + 1, type, payload: payload as object },
        });
        return event.seq;
      } catch {
        // seq 冲突：重试
      }
    }
    throw new Error(`事件写入失败: ${projectId}/${type}`);
  }

  async readAfter(projectId: string, afterSeq: number, limit = 200) {
    return this.prisma.event.findMany({
      where: { projectId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
  }

  async lastSeq(projectId: string): Promise<number> {
    const last = await this.prisma.event.findFirst({
      where: { projectId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return last?.seq ?? 0;
  }
}
