import type { StoryBibleDraft } from './story-schemas.ts';

export function getBlockingConflicts(storyBible: StoryBibleDraft): string[] {
  // conflicts 表示需要用户裁决的事实冲突；ambiguities 是低置信度信息，可带标记继续。
  return storyBible.conflicts;
}

export function assertStoryBibleConfirmable(storyBible: StoryBibleDraft): void {
  const conflicts = getBlockingConflicts(storyBible);
  if (conflicts.length > 0) {
    throw new Error(`StoryBible 存在 ${conflicts.length} 个阻断冲突：${conflicts.join('；')}`);
  }
}
