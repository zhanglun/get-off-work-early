import type { CharacterCard, LegacyShot, ShotResult } from './schemas.ts';
import type { ParsedScript, StoryBibleDraft } from './story-schemas.ts';

export interface StoredStoryUnderstanding {
  projectId: string;
  projectName: string;
  episodeId: string;
  episodeNo: number;
  scriptVersionId: string;
  storyBibleId: string;
  scriptText: string;
  parsedScript: ParsedScript;
  storyBible: StoryBibleDraft;
  status: 'awaiting_confirmation' | 'confirmed';
}

export interface StoredTask {
  taskId: string;
  scriptText: string;
  episodeNo?: number;
  status: 'queued' | 'processing' | 'done' | 'needs_review' | 'failed';
  progress: { done: number; total: number };
  error?: string;
  oldShots: LegacyShot[];
  characters: CharacterCard[];
  shots: ShotResult[];
}

/**
 * 可替换的领域存储：当前用内存实现，让 mock 链路零外部依赖跑通。
 * 下一步可替换为 PostgreSQL/Prisma；Agent 和 Workflow 不需要改动。
 */
export class StoryboardStore {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly storyUnderstandings = new Map<string, StoredStoryUnderstanding>();

  createTask(input: { taskId: string; scriptText: string; episodeNo?: number }): StoredTask {
    const task: StoredTask = {
      ...input,
      status: 'queued',
      progress: { done: 0, total: 0 },
      oldShots: [],
      characters: [],
      shots: [],
    };
    this.tasks.set(input.taskId, task);
    return task;
  }

  getTask(taskId: string): StoredTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    return task;
  }

  update(taskId: string, patch: Partial<StoredTask>): StoredTask {
    const task = this.getTask(taskId);
    Object.assign(task, patch);
    return task;
  }

  saveLegacy(taskId: string, oldShots: LegacyShot[]): void {
    this.getTask(taskId).oldShots = oldShots;
  }

  saveCharacters(taskId: string, characters: CharacterCard[]): void {
    this.getTask(taskId).characters = characters;
  }

  saveStoryUnderstanding(input: Omit<StoredStoryUnderstanding, 'status'> & { status: StoredStoryUnderstanding['status'] }): void {
    this.storyUnderstandings.set(input.episodeId, input);
  }

  getStoryUnderstanding(episodeId: string): StoredStoryUnderstanding {
    const result = this.storyUnderstandings.get(episodeId);
    if (!result) throw new Error(`StoryBible 不存在: ${episodeId}`);
    return result;
  }

  confirmStoryBible(episodeId: string): StoredStoryUnderstanding {
    const result = this.getStoryUnderstanding(episodeId);
    result.status = 'confirmed';
    return result;
  }

  saveShot(taskId: string, shot: ShotResult): void {
    const task = this.getTask(taskId);
    const index = task.shots.findIndex((item) => item.seq === shot.seq);
    if (index >= 0) task.shots[index] = shot;
    else task.shots.push(shot);
    task.shots.sort((a, b) => a.seq - b.seq);
  }
}

export const storyboardStore = new StoryboardStore();
