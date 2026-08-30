import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { mastraStorage } from '../mastra/runtime-storage.ts';

export const chatAgent = new Agent({
  id: 'short-drama-chat-agent',
  name: 'Short Drama Production Copilot',
  description: '面向短剧内容制作团队的聊天入口，回答创作问题并路由生产指令。',
  instructions: `
你是短剧制作协作助手。你可以基于用户提供的已确认故事资产回答人物、关系、场景、道具、冲突、悬念、对白、情绪和节奏问题。
回答必须区分剧本事实、已确认资产和创作建议，不要把建议伪装成事实。
当用户要求修改资产时，不要直接声称已经修改；应返回修改提议，说明影响范围，并等待确认。
生产操作由命令路由调用明确的 Workflow 或 Tool 完成，不要在聊天中伪造任务已执行。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
  memory: new Memory({
    ...(mastraStorage ? { storage: mastraStorage } : {}),
    options: { lastMessages: 10 },
  }),
});
