import { PrismaClient } from '@prisma/client';

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
}

export interface EpisodeRecord {
  id: string;
  projectId: string;
  episodeNo: number;
  title?: string;
  status: string;
}

export interface ProjectRepository {
  createProject(input: { id: string; name: string; description?: string }): Promise<ProjectRecord>;
  createEpisode(input: { id: string; projectId: string; episodeNo: number; title?: string }): Promise<EpisodeRecord>;
  getEpisode(id: string): Promise<EpisodeRecord | null>;
  close?(): Promise<void>;
}

export class MemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly episodes = new Map<string, EpisodeRecord>();

  async createProject(input: { id: string; name: string; description?: string }): Promise<ProjectRecord> {
    const project = { ...input };
    this.projects.set(project.id, project);
    return project;
  }

  async createEpisode(input: { id: string; projectId: string; episodeNo: number; title?: string }): Promise<EpisodeRecord> {
    if (!this.projects.has(input.projectId)) throw new Error(`项目不存在: ${input.projectId}`);
    const episode = { ...input, status: 'draft' };
    this.episodes.set(episode.id, episode);
    return episode;
  }

  async getEpisode(id: string): Promise<EpisodeRecord | null> {
    return this.episodes.get(id) ?? null;
  }
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async createProject(input: { id: string; name: string; description?: string }): Promise<ProjectRecord> {
    const project = await this.prisma.project.upsert({
      where: { id: input.id },
      create: input,
      update: { name: input.name, description: input.description },
    });
    return { id: project.id, name: project.name, description: project.description ?? undefined };
  }

  async createEpisode(input: { id: string; projectId: string; episodeNo: number; title?: string }): Promise<EpisodeRecord> {
    const episode = await this.prisma.episode.create({ data: input });
    return { id: episode.id, projectId: episode.projectId, episodeNo: episode.episodeNo, title: episode.title ?? undefined, status: episode.status };
  }

  async getEpisode(id: string): Promise<EpisodeRecord | null> {
    const episode = await this.prisma.episode.findUnique({ where: { id } });
    return episode ? { id: episode.id, projectId: episode.projectId, episodeNo: episode.episodeNo, title: episode.title ?? undefined, status: episode.status } : null;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const projectRepository: ProjectRepository = process.env.STORAGE_MODE === 'postgres'
  ? new PrismaProjectRepository()
  : new MemoryProjectRepository();
