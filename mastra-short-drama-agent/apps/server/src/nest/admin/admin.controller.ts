import { Controller, Post, Body, Res, HttpCode, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { adminResetSchema } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';

@Controller('api/admin')
export class AdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 管理口令 → 清空全部 Demo 业务数据（保留用户与会话）。 */
  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = adminResetSchema.parse(body);
    const token = process.env.ADMIN_TOKEN ?? 'demo-admin';
    if (input.token !== token) {
      res.status(403).json({ code: 'FORBIDDEN', message: '管理员口令不正确' });
      return;
    }
    await this.prisma.$transaction([
      this.prisma.event.deleteMany({}),
      this.prisma.projectExport.deleteMany({}),
      this.prisma.domainTask.deleteMany({}),
      this.prisma.issue.deleteMany({}),
      this.prisma.assetVersion.deleteMany({}),
      this.prisma.episodeAssetOverride.deleteMany({}),
      this.prisma.projectAsset.deleteMany({}),
      this.prisma.message.deleteMany({}),
      this.prisma.conversation.deleteMany({}),
      this.prisma.review.deleteMany({}),
      this.prisma.promptVersion.deleteMany({}),
      this.prisma.shot.deleteMany({}),
      this.prisma.scene.deleteMany({}),
      this.prisma.timelineEvent.deleteMany({}),
      this.prisma.relationship.deleteMany({}),
      this.prisma.prop.deleteMany({}),
      this.prisma.location.deleteMany({}),
      this.prisma.character.deleteMany({}),
      this.prisma.storyBible.deleteMany({}),
      this.prisma.scriptVersion.deleteMany({}),
      this.prisma.exportPackage.deleteMany({}),
      this.prisma.episode.deleteMany({}),
      this.prisma.project.deleteMany({}),
    ]);
    return { ok: true };
  }
}
