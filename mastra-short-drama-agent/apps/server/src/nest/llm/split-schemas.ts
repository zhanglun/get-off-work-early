import { z } from 'zod';
import type { ScenePlan } from './scene-schemas.ts';

// ── 拆集分组 ──
export const episodeGroupSchema = z.object({
  episodeNo: z.number().int().positive(),
  title: z.string().nullable(),
  sceneIndexes: z.array(z.number().int().nonnegative()).min(1),
  summary: z.string(),
});
export const episodeGroupListSchema = z.object({
  episodes: z.array(episodeGroupSchema).min(2).max(99),
});
export type EpisodeGroupList = z.infer<typeof episodeGroupListSchema>;

// ── 拆集审查 ──
export const episodeSplitReviewSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.object({
    episodeNo: z.number().int().positive().nullable(),
    issue: z.string(),
    suggestion: z.string(),
  })),
  corrected: episodeGroupListSchema.nullable(),
});
export type EpisodeSplitReview = z.infer<typeof episodeSplitReviewSchema>;

// ── 镜头规划 ──
export const SHOT_PLAN_LIMITS = { perSceneMin: 1, perSceneMax: 15, totalMin: 4, totalMax: 120 } as const;

export const shotPlanItemSchema = z.object({
  sceneNo: z.number().int().positive(),
  shotCount: z.number().int().positive(),
  rationale: z.string().nullable(),
});
export const shotPlanListSchema = z.object({
  scenes: z.array(shotPlanItemSchema).min(1),
});
export type ShotPlanList = z.infer<typeof shotPlanListSchema>;

/** 镜头规划结构校验：场次全覆盖不重复、每场数量合理、总数在有效区间。 */
export function validateShotPlan(plan: ShotPlanList, scenePlans: ScenePlan[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const expected = new Set(scenePlans.map((scene) => scene.sceneNo));
  const seen = new Set<number>();
  let total = 0;
  for (const item of plan.scenes) {
    if (!Number.isInteger(item.sceneNo) || !expected.has(item.sceneNo)) {
      problems.push(`未知场次：${JSON.stringify(item.sceneNo)}`);
      continue;
    }
    if (seen.has(item.sceneNo)) problems.push(`场次 ${item.sceneNo} 被规划多次`);
    seen.add(item.sceneNo);
    if (!Number.isInteger(item.shotCount) || item.shotCount < SHOT_PLAN_LIMITS.perSceneMin || item.shotCount > SHOT_PLAN_LIMITS.perSceneMax) {
      problems.push(`场次 ${item.sceneNo} 镜头数必须在 ${SHOT_PLAN_LIMITS.perSceneMin}-${SHOT_PLAN_LIMITS.perSceneMax}，当前 ${JSON.stringify(item.shotCount)}`);
    }
    total += item.shotCount;
  }
  const missing = [...expected].filter((sceneNo) => !seen.has(sceneNo));
  if (missing.length) problems.push(`缺少场次规划：${missing.join('、')}`);
  if (total < SHOT_PLAN_LIMITS.totalMin || total > SHOT_PLAN_LIMITS.totalMax) {
    problems.push(`镜头总数必须在 ${SHOT_PLAN_LIMITS.totalMin}-${SHOT_PLAN_LIMITS.totalMax}，当前 ${total}`);
  }
  return { ok: problems.length === 0, problems };
}
