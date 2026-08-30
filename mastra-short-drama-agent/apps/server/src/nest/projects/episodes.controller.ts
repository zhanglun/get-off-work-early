import { Controller, Post, Param, HttpCode, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

@Controller('api/projects/:projectId/episodes')
export class EpisodesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 记录「上次打开的剧集」，供项目列表与工作区恢复。 */
  @Post(':episodeId/open')
  @HttpCode(200)
  async open(@Param('episodeId') episodeId: string) {
    await this.prisma.episode.update({ where: { id: episodeId }, data: { openedAt: new Date() } });
    return { ok: true };
  }
}
