import { Agent } from '@mastra/core/agent';
import { storyBibleDraftSchema } from '../domain/story-schemas.ts';

export const scriptAnalystAgent = new Agent({
  id: 'script-analyst',
  name: 'Script Analyst',
  description: '将短剧剧本和确定性解析结果整理为可确认的 StoryBible 草稿。',
  instructions: `
你是短剧剧本分析师。你的任务不是改写剧本，而是建立可供制作团队确认的 StoryBible 草稿。
输入会同时包含原始剧本和程序预解析结果。程序解析出的场次、对白和动作是事实线索，不要无依据地改变它们。
你需要补充：剧本摘要、logline、角色外观与性格、场景空间、关键道具、人物关系、时间线、剧情目的和不确定项。
所有 sourceRefs 必须指向输入中的剧本或预解析场次；不能把猜测伪装成剧本事实。
如果剧本没有明确描述，使用合理的“待确认”措辞并降低 confidence，必要时写入 ambiguities。
输出必须符合给定结构化 schema，不要输出 Markdown。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
});

export { storyBibleDraftSchema as scriptAnalystOutputSchema };
