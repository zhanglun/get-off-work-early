import type { ParsedScene, ParsedScript } from './story-schemas.ts';

const scenePattern = /^#{1,6}\s*(?:第\s*)?(\d+)\s*场(?:\s+|[-—:：])?(.*)$/i;
const industryScenePattern = /^(\d+)\.\s*(INT\.|EXT\.|内|外)?\s*(.+)$/i;

function splitValues(value: string): string[] {
  return value
    .split(/[、,，；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHeading(value: string): { timeLabel: string | null; locationLabel: string | null } {
  const parts = value.split(/[\/｜|]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { timeLabel: parts[0], locationLabel: parts.slice(1).join(' / ') };
  const time = value.match(/(清晨|早晨|上午|中午|下午|傍晚|晚上|深夜|夜间|白天|夜)/);
  return {
    timeLabel: time?.[1] ?? null,
    locationLabel: value.replace(time?.[0] ?? '', '').trim() || null,
  };
}

export function parseScriptMarkdown(scriptText: string): ParsedScript {
  const lines = scriptText.replaceAll('\r\n', '\n').split('\n');
  const scenes: ParsedScene[] = [];
  const warnings: string[] = [];
  let title: string | null = null;
  let current: ParsedScene | null = null;

  const flush = () => {
    if (!current) return;
    current.rawText = [current.heading, ...current.actions, ...current.dialogues, ...current.notes].join('\n');
    scenes.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!title && /^#\s+/.test(line) && !scenePattern.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }

    const sceneMatch = line.match(scenePattern) ?? line.match(industryScenePattern);
    if (sceneMatch) {
      flush();
      const sceneNo = Number(sceneMatch[1]);
      const heading = sceneMatch === undefined
        ? line
        : sceneMatch[3]
          ? [sceneMatch[2], sceneMatch[3]].filter(Boolean).join(' ').trim()
          : sceneMatch[2]?.trim() || line;
      const { timeLabel, locationLabel } = parseHeading(heading);
      current = {
        sceneNo,
        heading,
        timeLabel,
        locationLabel,
        characters: [],
        actions: [],
        dialogues: [],
        notes: [],
        rawText: '',
      };
      continue;
    }

    if (!current) {
      warnings.push(`场次标题之前的内容未归属场次：${line.slice(0, 80)}`);
      continue;
    }
    const field = line.match(/^【(人物|角色|动作|对白|台词|备注|场景|时间)】\s*(.*)$/);
    if (field) {
      const value = field[2].trim();
      switch (field[1]) {
        case '人物':
        case '角色':
          current.characters.push(...splitValues(value));
          break;
        case '动作':
          current.actions.push(value);
          break;
        case '对白':
        case '台词':
          current.dialogues.push(value);
          break;
        case '备注':
          current.notes.push(value);
          break;
        case '场景':
          current.locationLabel = value;
          break;
        case '时间':
          current.timeLabel = value;
          break;
      }
      continue;
    }

    const dialogue = line.match(/^([^：:]{1,30})[：:]\s*(.+)$/);
    if (dialogue && current) {
      current.characters.push(dialogue[1].trim());
      current.dialogues.push(line);
      continue;
    }
    current.actions.push(line);
  }
  flush();

  if (scenes.length === 0) warnings.push('没有识别到场次标题，请使用“## 第1场 ...”或“1. INT./EXT. ...”格式。');
  const uniqueCharacters = new Set(scenes.flatMap((scene) => scene.characters));
  for (const scene of scenes) scene.characters = [...new Set(scene.characters)];

  return {
    format: lines.some((line) => scenePattern.test(line.trim()))
      ? 'basic-markdown'
      : lines.some((line) => industryScenePattern.test(line.trim()))
        ? 'industry-markdown'
        : 'unknown',
    title,
    scenes,
    warnings: [...warnings, ...(uniqueCharacters.size === 0 && scenes.length > 0 ? ['未识别到明确角色，后续 Agent 需要从动作和对白中补充。'] : [])],
  };
}
