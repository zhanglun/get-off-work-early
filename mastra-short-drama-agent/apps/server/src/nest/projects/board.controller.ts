import { Controller, Get, Param, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service.js';

@Controller('api/episodes')
export class BoardController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 图版区数据：阶段进度 + 场次分镜 + 穿帮 + 项目级资产。 */
  @Get(':id/board')
  async board(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const episode = await this.prisma.episode.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!episode) {
      res.status(404).json({ code: 'NOT_FOUND', message: '剧集不存在' });
      return;
    }
    const task = await this.prisma.domainTask.findFirst({
      where: { episodeId: id },
      orderBy: { createdAt: 'desc' },
    });
    // 只展示最新 StoryBible 的场次：重启动恢复会生成新版本，旧版本场次属于历史
    const latestBible = await this.prisma.storyBible.findFirst({
      where: { episodeId: id },
      orderBy: { version: 'desc' },
    });
    const scenes = latestBible
      ? await this.prisma.scene.findMany({
          where: { storyBibleId: latestBible.id },
          orderBy: { sceneNo: 'asc' },
          include: { shots: { orderBy: { sequence: 'asc' }, include: { prompts: true } } },
        })
      : [];
    const issues = await this.prisma.issue.findMany({
      where: { episodeId: id },
      orderBy: { createdAt: 'asc' },
    });
    const assets = await this.prisma.projectAsset.findMany({
      where: { projectId: episode.projectId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }] as never,
    });
    return {
      episode: {
        id: episode.id,
        episodeNo: episode.episodeNo,
        status: episode.status,
        shotTarget: episode.shotTarget,
      },
      stages: task?.progress ?? { stage: 'parse', stages: {}, shotsDone: 0, shotsTotal: 0 },
      taskStatus: task?.status ?? null,
      scenes: scenes.map((scene) => ({
        sceneNo: scene.sceneNo,
        heading: scene.heading,
        timeLabel: scene.timeLabel,
        locationLabel: scene.locationLabel,
        objective: scene.objective,
        shots: scene.shots.map((shot) => ({
          sequence: shot.sequence,
          status: shot.status,
          draft: (shot.payload ?? {}) as Record<string, unknown>,
          promptVersions: shot.prompts.length,
        })),
      })),
      issues: issues.map((issue) => ({
        id: issue.id,
        kind: issue.kind,
        severity: issue.severity,
        issue: issue.issue,
        suggestion: issue.suggestion,
        targetId: issue.targetId,
        status: issue.status,
      })),
      projectAssets: assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        data: asset.data,
      })),
    };
  }
}
