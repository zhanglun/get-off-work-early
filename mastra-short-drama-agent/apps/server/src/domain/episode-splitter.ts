import type { ParsedScript } from './story-schemas.ts';

/** 一段待登记的分集切片：原文行区间 + 对应解析场次下标。 */
export interface EpisodeSegment {
  episodeNo: number;
  title: string | null;
  startLine: number;
  endLine: number;
  content: string;
  sceneIndexes: number[];
}

/** 拆分分组（模型输出的目标形态），sceneIndexes 为解析场次在 parsed.scenes 中的下标。 */
export interface EpisodeGroup {
  episodeNo: number;
  title: string | null;
  sceneIndexes: number[];
  summary?: string | null;
}

const EPISODE_MARKER_PATTERNS = [
  /^第\s*(\d+)\s*[集话回]\s*(.*)$/,
  /^(?:EP|Episode)\s*(\d+)\s*(.*)$/i,
];

/** 识别一行是否为分集标题；对白等长行中的「第X集」不误判。 */
export function matchEpisodeMarker(rawLine: string): { no: number; title: string | null } | null {
  const heading = rawLine.match(/^#{1,6}\s+(.*)$/);
  const text = (heading ? heading[1] : rawLine).trim();
  if (!heading && text.length > 30) return null;
  for (const pattern of EPISODE_MARKER_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const title = match[2].replace(/^[:：、\-—\s]+/, '').trim();
    return { no: Number(match[1]), title: title || null };
  }
  return null;
}

export interface RuleSplitResult {
  segments: EpisodeSegment[];
  matchedMarkers: number;
}

/**
 * 规则拆分：按分集标题行切片原文。
 * 成功标准：≥2 个分集标记且每段至少包含 1 场；不满足时返回空 segments（交由模型辅助）。
 */
export function splitEpisodesByRules(scriptText: string, parsed: ParsedScript): RuleSplitResult {
  const lines = scriptText.replaceAll('\r\n', '\n').split('\n');
  const markers: { line: number; no: number; title: string | null }[] = [];
  lines.forEach((raw, index) => {
    const marker = matchEpisodeMarker(raw);
    if (marker) markers.push({ line: index, ...marker });
  });
  if (markers.length < 2) return { segments: [], matchedMarkers: markers.length };

  const segments: EpisodeSegment[] = [];
  for (const [index, marker] of markers.entries()) {
    const start = index === 0 ? 0 : marker.line;
    const end = index + 1 < markers.length ? markers[index + 1].line : lines.length;
    const sceneIndexes = parsed.scenes
      .map((scene, sceneIndex) => ({ startLine: scene.startLine, sceneIndex }))
      .filter(({ startLine }) => startLine >= start && startLine < end)
      .map(({ sceneIndex }) => sceneIndex);
    segments.push({
      episodeNo: marker.no,
      title: marker.title,
      startLine: start,
      endLine: end,
      content: lines.slice(start, end).join('\n').trim(),
      sceneIndexes,
    });
  }
  const ok = segments.every((segment) => segment.sceneIndexes.length > 0);
  return { segments: ok ? segments : [], matchedMarkers: markers.length };
}

/**
 * 分组结构校验：模型输出必须构成对全部场次的完整划分——
 * 不重不漏、下标越界为零、集数为正且严格递增。返回问题清单供反馈重试。
 */
export function validateEpisodeGroups(groups: EpisodeGroup[], sceneCount: number): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (groups.length < 2) problems.push(`分组数必须 ≥ 2，当前 ${groups.length}`);
  const seen = new Set<number>();
  let lastNo = 0;
  for (const group of groups) {
    if (!Number.isInteger(group.episodeNo) || group.episodeNo < 1) {
      problems.push(`集数非法：${JSON.stringify(group.episodeNo)}`);
    } else if (group.episodeNo <= lastNo) {
      problems.push(`集数必须严格递增：${group.episodeNo} 出现在 ${lastNo} 之后`);
    } else {
      lastNo = group.episodeNo;
    }
    if (!group.sceneIndexes.length) problems.push(`第 ${group.episodeNo} 集没有分配任何场次`);
    for (const index of group.sceneIndexes) {
      if (!Number.isInteger(index) || index < 0 || index >= sceneCount) {
        problems.push(`场次下标越界：${JSON.stringify(index)}`);
      } else if (seen.has(index)) {
        problems.push(`场次下标 ${index} 被分配给多集`);
      } else {
        seen.add(index);
      }
    }
  }
  if (seen.size !== sceneCount) problems.push(`${sceneCount} 个场次中有 ${sceneCount - seen.size} 个未被分配`);
  return { ok: problems.length === 0, problems };
}

/** 组装模型可读的场次清单（下标 + 标题 + 行数），供拆集与审查共用。 */
export function sceneBriefList(parsed: ParsedScript): string {
  return parsed.scenes
    .map((scene, index) => {
      const lines = scene.rawText ? scene.rawText.split('\n').length : 0;
      return `场次${index}：${scene.heading}（${scene.sceneNo} 场 · ${lines} 行 · 对白 ${scene.dialogues.length} 条）`;
    })
    .join('\n');
}

/** 按模型分组切出各集原文：以场次起始行为边界，前置序章并入第 1 集。 */
export function segmentsFromGroups(scriptText: string, groups: EpisodeGroup[], parsed: ParsedScript): EpisodeSegment[] {
  const lines = scriptText.replaceAll('\r\n', '\n').split('\n');
  const startLines = parsed.scenes.map((scene) => scene.startLine);
  return groups.map((group, groupIndex) => {
    const ordered = [...group.sceneIndexes].sort((a, b) => a - b);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const start = groupIndex === 0 ? 0 : startLines[first];
    const end = last + 1 < startLines.length ? startLines[last + 1] : lines.length;
    return {
      episodeNo: group.episodeNo,
      title: group.title,
      startLine: start,
      endLine: end,
      content: lines.slice(start, end).join('\n').trim(),
      sceneIndexes: ordered,
    };
  });
}
