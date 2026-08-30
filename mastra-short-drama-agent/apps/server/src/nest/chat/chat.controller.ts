import { Controller, Post, Param, Body, HttpCode, Inject } from '@nestjs/common';
import { z } from 'zod';
import { ChatService } from './chat.service.js';

const sendMessageSchema = z.object({
  content: z.string().min(1).max(200_000),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

@Controller('api/projects/:projectId/messages')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  /** 对话统一入口（导入 / 回答补问 / 补充要求）。 */
  @Post()
  @HttpCode(200)
  async send(@Param('projectId') projectId: string, @Body() body: unknown) {
    const input = sendMessageSchema.parse(body);
    return this.chat.sendMessage(projectId, input.content, input.meta ?? null);
  }
}
