import { Injectable, Inject } from '@nestjs/common';
import type { ProjectSummary, EpisodeSummary, Snapshot } from '@short-drama/shared';
import { PrismaService } from '../prisma.service.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { episodes: { orderBy: { episodeNo: 'desc' } } },
    });
    const issueCounts = await this.prisma.issue.groupBy({
      by: ['episodeId'],
      where: { status: 'open' },
      _count: { _all: true },
    });
    const episodeIssueMap = new Map(issueCounts.map((row) => [row.episodeId, row._count._all]));
    const running = await this.prisma.domainTask.findMany({
      where: { status: { in: ['queued', 'running'] } },
      select: { projectId: true },
    });
    const runningProjects = new Set(running.map((task) => task.projectId).filter(Boolean) as string[]);
    return projects.map((project) => {
      const episodes = project.episodes;
      const issueCount = episodes.reduce((sum, ep) => sum + (episodeIssueMap.get(ep.id) ?? 0), 0);
      const latest = episodes[0] ?? null;
      const status: ProjectSummary['latestStatus'] = runningProjects.has(project.id)
        ? 'running'
        : episodes.length === 0
          ? 'idle'
          : latest?.status === 'partial_failed'
            ? 'partial_failed'
            : latest?.status === 'failed'
              ? 'failed'
              : 'completed';
      return {
        id: project.id,
        name: project.name,
        episodeCount: episodes.length,
        latestEpisodeNo: latest?.episodeNo ?? null,
        latestStatus: status,
        openIssueCount: issueCount,
        lastOpenedEpisodeNo: episodes.find((ep) => ep.openedAt)?.episodeNo ?? latest?.episodeNo ?? null,
        updatedAt: project.updatedAt.toISOString(),
      };
    });
  }

  async create(name: string): Promise<{ id: string }> {
    const project = await this.prisma.project.create({
      data: { name, conversation: { create: {} } },
    });
    await this.events.append(project.id, 'project_created', { projectId: project.id, name });
    return { id: project.id };
  }

  async snapshot(projectId: string): Promise<Snapshot | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        episodes: { orderBy: { episodeNo: 'asc' } },
        conversation: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!project) return null;
    const activeTask = await this.prisma.domainTask.findFirst({
      where: { projectId, status: { in: ['queued', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      project: { id: project.id, name: project.name, updatedAt: project.updatedAt.toISOString() },
      episodes: project.episodes.map(
        (ep): EpisodeSummary => ({
          id: ep.id,
          episodeNo: ep.episodeNo,
          status: ep.status,
          shotTarget: ep.shotTarget,
          updatedAt: ep.updatedAt.toISOString(),
        }),
      ),
      messages: (project.conversation?.messages ?? []).map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        kind: msg.kind,
        content: msg.content,
        meta: msg.meta,
        createdAt: msg.createdAt.toISOString(),
      })),
      activeTask: activeTask
        ? { id: activeTask.id, kind: activeTask.kind, status: activeTask.status, progress: activeTask.progress }
        : null,
      lastSeq: await this.events.lastSeq(projectId),
    };
  }
}
