import { Controller, Get, Param, Query, Res, Req, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { EventsService } from './events.service.js';

@Controller('api/projects/:projectId/events')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  /** SSE 活动流：Last-Event-ID / afterSeq 断线续传，先 journal 后推送。 */
  @Get()
  async stream(
    @Param('projectId') projectId: string,
    @Query('afterSeq') afterSeq: string | undefined,
    @Req() req: { on: (event: string, cb: () => void) => void; headers: Record<string, string | string[] | undefined> },
    @Res() res: Response,
  ): Promise<void> {
    let cursor = Number(afterSeq ?? 0) || Number(req.headers['last-event-id'] ?? 0) || 0;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 2000\n\n`);

    const poll = setInterval(async () => {
      try {
        const rows = await this.events.readAfter(projectId, cursor, 100);
        for (const row of rows) {
          cursor = row.seq;
          res.write(`id: ${row.seq}\n`);
          res.write(`data: ${JSON.stringify({
            schemaVersion: 1,
            eventId: row.id,
            seq: row.seq,
            projectId: row.projectId,
            type: row.type,
            occurredAt: row.createdAt.toISOString(),
            payload: row.payload,
          })}\n\n`);
        }
        if (rows.length === 0) res.write(': hb\n\n');
      } catch (error) {
        console.error(JSON.stringify({ event: 'sse_poll_failed', projectId, error: String(error) }));
      }
    }, 800);

    const cleanup = () => {
      clearInterval(poll);
      res.end();
    };
    req.on('close', cleanup);
  }
}
