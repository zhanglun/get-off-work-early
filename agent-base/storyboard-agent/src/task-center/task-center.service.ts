import { Injectable, Logger } from '@nestjs/common';

// 任务生命周期由公司任务中心维护（单一事实源）。
// 本服务通过适配层对接：real 接口文档到手后，仅改本文件 callReal 部分，接口不变。
// mock 模式：内存态 + 日志，保证全链路无外部依赖可跑。

export interface TaskInput {
  taskCenterId: string;
  scriptText: string;
  episodeNo?: number;
  config: { maxRounds?: number; concurrency?: number };
}

export type TaskStatus = 'queued' | 'processing' | 'done' | 'failed';

@Injectable()
export class TaskCenterService {
  private readonly logger = new Logger(TaskCenterService.name);
  private mode = process.env.TASK_CENTER_MODE ?? 'mock';

  // ---- mock 内存态 ----
  private memTasks = new Map<
    string,
    TaskInput & { status: TaskStatus; progress: { done: number; total: number }; error?: string }
  >();

  async createTask(input: {
    scriptText: string;
    episodeNo?: number;
    config: TaskInput['config'];
  }): Promise<string> {
    if (this.mode === 'real') return this.callRealCreate(input);
    const taskCenterId = `tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.memTasks.set(taskCenterId, {
      ...input,
      taskCenterId,
      status: 'queued',
      progress: { done: 0, total: 0 },
    });
    this.logger.log(`[mock] createTask -> ${taskCenterId}`);
    return taskCenterId;
  }

  async getTaskInput(taskCenterId: string): Promise<TaskInput> {
    const t = this.memTasks.get(taskCenterId);
    if (!t) throw new Error(`[task-center] 任务不存在: ${taskCenterId}`);
    return { taskCenterId, scriptText: t.scriptText, episodeNo: t.episodeNo, config: t.config };
  }

  async updateStatus(taskCenterId: string, status: TaskStatus, error?: string): Promise<void> {
    if (this.mode === 'real') return this.callRealStatus(taskCenterId, status, error);
    const t = this.memTasks.get(taskCenterId);
    if (t) {
      t.status = status;
      t.error = error;
    }
    this.logger.log(`[mock] ${taskCenterId} -> ${status}${error ? ` (${error})` : ''}`);
  }

  async reportProgress(taskCenterId: string, done: number, total: number): Promise<void> {
    const t = this.memTasks.get(taskCenterId);
    if (t) t.progress = { done, total };
  }

  async getStatus(taskCenterId: string): Promise<{
    status: TaskStatus;
    progress: { done: number; total: number };
    error?: string;
  }> {
    const t = this.memTasks.get(taskCenterId);
    if (!t) throw new Error(`[task-center] 任务不存在: ${taskCenterId}`);
    return { status: t.status, progress: t.progress, error: t.error };
  }

  // ===== real 桩（周一接口文档到手后实现）=====
  private async callRealCreate(input: unknown): Promise<string> {
    throw new Error('[task-center] real 模式未实现——待接口文档（architecture.md §9 风险2）');
  }
  private async callRealStatus(id: string, status: TaskStatus, error?: string): Promise<void> {
    throw new Error('[task-center] real 模式未实现——待接口文档');
  }
}
