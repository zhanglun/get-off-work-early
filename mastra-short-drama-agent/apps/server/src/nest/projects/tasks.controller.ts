import { Controller, Post, Param, HttpCode, Inject, Get } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

@Controller('api/tasks')
export class TasksController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 取消：置 cancelRequested，管线在阶段/镜头间检查；已完成内容保留。 */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    await this.prisma.domainTask.update({
      where: { id },
      data: { cancelRequested: true },
    });
    return { ok: true, message: '已请求取消——已完成内容保留，稍后可继续制作或重新开始' };
  }

  @Get(':id')
  async status(@Param('id') id: string) {
    return this.prisma.domainTask.findUnique({ where: { id } });
  }
}
