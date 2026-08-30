import { z } from 'zod';

// ── 生成管线阶段（边栏阶段账）──
export const PIPELINE_STAGES = ['parse', 'assets', 'scenes', 'shots', 'review', 'package'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const STAGE_LABELS: Record<PipelineStage, string> = {
  parse: '剧本解析',
  assets: '故事资产',
  scenes: '场次规划',
  shots: '分镜生成',
  review: '连续性检查',
  package: '生产包',
};

// ── 任务状态 ──
export const TASK_STATUSES = ['queued', 'running', 'completed', 'partial_failed', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '已排队',
  running: '正在生成',
  completed: '已完成',
  partial_failed: '部分完成',
  failed: '生成失败',
  cancelled: '已取消',
};

// ── SSE 事件契约（前后端唯一类型源）──
export const EVENT_TYPES = [
  'project_created',
  'episode_created',
  'message',
  'run_started',
  'stage_started',
  'stage_progress',
  'stage_completed',
  'artifact_created',
  'artifact_updated',
  'issue_reported',
  'done',
  'error',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const streamEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1),
  seq: z.number().int().positive(),
  projectId: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  occurredAt: z.string(),
  payload: z.unknown(),
});
export type StreamEvent = z.infer<typeof streamEventSchema>;

// ── 对话补问链（依次：项目名 → 集数 → 镜头数）──
export const QUESTION_KINDS = ['project_name', 'episode_no', 'shot_count'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const SHOT_COUNT_RANGE = { min: 20, max: 40, default: 30 } as const;

// ── API DTO ──
export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  episodeCount: z.number().int().nonnegative(),
  latestEpisodeNo: z.number().int().nullable(),
  latestStatus: z.enum(['idle', 'running', 'completed', 'partial_failed', 'failed']),
  openIssueCount: z.number().int().nonnegative(),
  lastOpenedEpisodeNo: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const episodeSummarySchema = z.object({
  id: z.string(),
  episodeNo: z.number().int(),
  status: z.string(),
  shotTarget: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type EpisodeSummary = z.infer<typeof episodeSummarySchema>;

export const messageDtoSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  kind: z.string(),
  content: z.string(),
  meta: z.unknown().nullable(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof messageDtoSchema>;

export const snapshotSchema = z.object({
  project: z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  episodes: z.array(episodeSummarySchema),
  messages: z.array(messageDtoSchema),
  activeTask: z
    .object({ id: z.string(), kind: z.string(), status: z.string(), progress: z.unknown() })
    .nullable(),
  lastSeq: z.number().int(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const adminResetSchema = z.object({ token: z.string().min(1) });
