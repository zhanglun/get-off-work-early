import { PrismaClient, type Prisma } from '@prisma/client';

export type DomainTaskStatus = 'queued' | 'running' | 'done' | 'needs_review' | 'failed';

export interface DomainTaskRecord {
  id: string;
  kind: string;
  status: DomainTaskStatus;
  progress: { done: number; total?: number };
  inputRef?: string;
  outputRef?: string;
  error?: string;
}

export interface TaskRepository {
  create(task: DomainTaskRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<DomainTaskRecord, 'id'>>): Promise<void>;
  get(id: string): Promise<DomainTaskRecord | null>;
  close?(): Promise<void>;
}

export class MemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, DomainTaskRecord>();

  async create(task: DomainTaskRecord): Promise<void> {
    this.tasks.set(task.id, task);
  }
  async update(id: string, patch: Partial<Omit<DomainTaskRecord, 'id'>>): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`任务不存在: ${id}`);
    Object.assign(task, patch);
  }
  async get(id: string): Promise<DomainTaskRecord | null> {
    return this.tasks.get(id) ?? null;
  }
}

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly prisma = new PrismaClient()) {}

  async create(task: DomainTaskRecord): Promise<void> {
    await this.prisma.domainTask.create({
      data: {
        id: task.id,
        kind: task.kind,
        status: task.status,
        progress: task.progress as Prisma.InputJsonValue,
        inputRef: task.inputRef,
        outputRef: task.outputRef,
        error: task.error,
      },
    });
  }
  async update(id: string, patch: Partial<Omit<DomainTaskRecord, 'id'>>): Promise<void> {
    await this.prisma.domainTask.update({
      where: { id },
      data: {
        kind: patch.kind,
        status: patch.status,
        progress: patch.progress as Prisma.InputJsonValue | undefined,
        inputRef: patch.inputRef,
        outputRef: patch.outputRef,
        error: patch.error,
      },
    });
  }
  async get(id: string): Promise<DomainTaskRecord | null> {
    const task = await this.prisma.domainTask.findUnique({ where: { id } });
    if (!task) return null;
    return {
      id: task.id,
      kind: task.kind,
      status: task.status as DomainTaskStatus,
      progress: task.progress as { done: number; total?: number },
      inputRef: task.inputRef ?? undefined,
      outputRef: task.outputRef ?? undefined,
      error: task.error ?? undefined,
    };
  }
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const taskRepository: TaskRepository = process.env.STORAGE_MODE === 'postgres'
  ? new PrismaTaskRepository()
  : new MemoryTaskRepository();
