import { chatAgent } from '../agents/chat-agent.ts';
import { chatInputSchema, type ChatResult } from './chat-schemas.ts';
import { storyRepository } from './story-repository.ts';
import { sceneRepository } from './scene-repository.ts';
import { productionRepository } from './production-repository.ts';
import { exportEpisode } from './export-service.ts';
import { storyUnderstandingWorkflow } from '../workflows/story-understanding-workflow.ts';
import { scenePlanningWorkflow } from '../workflows/scene-planning-workflow.ts';
import { storyboardProductionWorkflow } from '../workflows/storyboard-production-workflow.ts';
import { taskRepository } from './task-repository.ts';
import { randomUUID } from 'node:crypto';

async function startWorkflowTask(kind: string, inputRef: string, runWorkflow: () => Promise<void>): Promise<string> {
  const runId = randomUUID();
  await taskRepository.create({ id: runId, kind, status: 'queued', progress: { done: 0, total: 1 }, inputRef });
  void (async () => {
    await taskRepository.update(runId, { status: 'running' });
    try {
      await runWorkflow();
      await taskRepository.update(runId, { status: 'done', outputRef: inputRef, progress: { done: 1, total: 1 } });
    } catch (error) {
      await taskRepository.update(runId, { status: 'failed', error: String(error) });
    }
  })();
  return runId;
}

function parseShotReference(message: string): { sceneNo: number; sequence: number } | null {
  const match = message.match(/(?:场|scene)\s*(\d+).*?(?:镜|shot)\s*(\d+)/i);
  return match ? { sceneNo: Number(match[1]), sequence: Number(match[2]) } : null;
}

function detectCommand(message: string): string {
  if (/确认.*故事|确认.*StoryBible/i.test(message)) return 'confirm-story-bible';
  if (/确认.*场次|确认.*Scene/i.test(message)) return 'confirm-scenes';
  if (/生成.*场次|规划.*场次/.test(message)) return 'plan-scenes';
  if (/生成.*分镜|生产.*分镜/.test(message)) return 'produce-storyboard';
  if (/重新生成.*镜|重跑.*镜/.test(message)) return 'regenerate-shot';
  if (/查看.*StoryBible|查看.*故事资产|角色卡/.test(message)) return 'get-story-bible';
  if (/查看.*分镜|查看.*镜头/.test(message)) return 'get-shots';
  if (/解释.*审查|为什么.*穿帮|审查问题/.test(message)) return 'explain-review';
  if (/版本.*差异|查看.*diff/i.test(message)) return 'version-diff';
  if (/导出.*JSON/i.test(message)) return 'export-json';
  if (/导出/.test(message)) return 'export-markdown';
  if (/分析.*剧本/.test(message)) return 'analyze-script';
  return 'creative-question';
}

export async function handleChat(raw: unknown): Promise<ChatResult> {
  const input = chatInputSchema.parse(raw);
  const intent = detectCommand(input.message);
  if (intent === 'analyze-script') {
    if (!input.scriptText) return { kind: 'clarification', intent, text: '请在请求中提供 scriptText，或先通过剧本导入接口提交剧本。' };
    const runId = await startWorkflowTask('story-understanding', input.episodeId ?? 'chat', async () => {
      const run = await storyUnderstandingWorkflow.createRun();
      const result = await run.start({ inputData: { episodeId: input.episodeId, projectName: '聊天导入短剧', episodeNo: 1, scriptText: input.scriptText! } });
      if (result.status !== 'success') throw new Error(JSON.stringify(result));
    });
    return { kind: 'command', intent, text: '已启动 Story Understanding Workflow。', data: { runId } };
  }
  if (!input.episodeId) return { kind: 'clarification', intent, text: '此操作需要 episodeId，请先选择或创建一个剧集。' };

  if (intent === 'confirm-story-bible') {
    const result = await storyRepository.confirmStoryBible(input.episodeId);
    return { kind: 'command', intent, text: 'StoryBible 已确认。', data: result };
  }
  if (intent === 'confirm-scenes') {
    const result = await sceneRepository.confirmScenePlans(input.episodeId);
    return { kind: 'command', intent, text: 'Scene 规划已确认。', data: result };
  }
  if (intent === 'get-story-bible') {
    const result = await storyRepository.getStoryUnderstanding(input.episodeId);
    return { kind: 'command', intent, text: result ? '已读取 StoryBible。' : 'StoryBible 不存在。', data: result };
  }
  if (intent === 'get-shots') {
    const result = await productionRepository.listShots(input.episodeId);
    return { kind: 'command', intent, text: `已读取 ${result.length} 个镜头。`, data: result };
  }
  if (intent === 'export-json' || intent === 'export-markdown') {
    const result = await exportEpisode(input.episodeId, intent === 'export-json' ? 'json' : 'markdown');
    return { kind: 'command', intent, text: `已导出 ${result.format} 生产包。`, data: result };
  }
  if (intent === 'plan-scenes') {
    const runId = await startWorkflowTask('scene-planning', input.episodeId, async () => {
      const run = await scenePlanningWorkflow.createRun();
      const result = await run.start({ inputData: { episodeId: input.episodeId! } });
      if (result.status !== 'success') throw new Error(JSON.stringify(result));
    });
    return { kind: 'command', intent, text: '已启动 Scene Planning Workflow。', data: { runId, episodeId: input.episodeId } };
  }
  if (intent === 'produce-storyboard' || intent === 'regenerate-shot') {
    const shot = intent === 'regenerate-shot' ? parseShotReference(input.message) : null;
    const runId = await startWorkflowTask('storyboard-production', input.episodeId, async () => {
      const run = await storyboardProductionWorkflow.createRun();
      const result = await run.start({ inputData: {
        episodeId: input.episodeId!,
        maxRounds: 3,
        concurrency: 3,
        ...(shot ? { shotSequences: [shot] } : {}),
      } });
      if (result.status !== 'success') throw new Error(JSON.stringify(result));
    });
    return { kind: 'command', intent, text: shot ? `已启动场${shot.sceneNo}镜${shot.sequence}的局部重跑。` : '已启动分镜生产 Workflow。', data: { runId, episodeId: input.episodeId, shot } };
  }
  if (intent === 'explain-review') {
    const shots = await productionRepository.listShots(input.episodeId);
    const shot = parseShotReference(input.message);
    const target = shot ? shots.find((item) => item.sceneNo === shot.sceneNo && item.sequence === shot.sequence) : undefined;
    return {
      kind: 'command',
      intent,
      text: target ? `已读取场${target.sceneNo}镜${target.sequence}的审查记录，共 ${target.reviews.length} 轮。` : `已读取本集 ${shots.reduce((sum, item) => sum + item.reviews.length, 0)} 条审查记录。`,
      data: target ? { shot: target, explanation: 'findings 是触发修订的具体原因；changes 是 Refiner 的处理说明。' } : { reviews: shots.flatMap((item) => item.reviews.map((review) => ({ sceneNo: item.sceneNo, sequence: item.sequence, ...review }))) },
    };
  }
  if (intent === 'version-diff') {
    const shot = parseShotReference(input.message);
    if (!shot) return { kind: 'clarification', intent, text: '请指定镜头，例如“查看场1镜1的版本差异”。' };
    const versions = await productionRepository.listPromptVersions(input.episodeId, shot.sceneNo, shot.sequence);
    const diffs = versions.length >= 2 ? [{ path: 'content', before: versions.at(-2)?.content, after: versions.at(-1)?.content }] : [];
    return { kind: 'command', intent, text: `已读取场${shot.sceneNo}镜${shot.sequence}的 ${versions.length} 个提示词版本。`, data: { versions, diffs } };
  }

  if (/改|修改|调整|换成|增强/.test(input.message)) {
    const current = await storyRepository.getStoryUnderstanding(input.episodeId);
    const proposal = {
      id: randomUUID(),
      targetType: 'episode' as const,
      targetId: input.episodeId,
      changeType: 'creative-request',
      riskLevel: 'medium' as const,
      before: { episodeId: input.episodeId },
      after: { instruction: input.message },
      reason: '用户通过聊天提出创作修改请求',
      impactScope: [`episode:${input.episodeId}`],
      status: 'pending' as const,
    };
    // episode 不在变更提议枚举中时，用 StoryBible 作为确认边界。
    const safeProposal = { ...proposal, targetType: 'story-bible' as const, before: current?.storyBible ?? null };
    await productionRepository.createChangeProposal(safeProposal);
    return { kind: 'command', intent: 'change-proposal', text: '已创建修改提议，未直接修改业务资产；请审批 before/after 后再执行。', data: safeProposal };
  }

  const [story, scenes, shots] = await Promise.all([
    storyRepository.getStoryUnderstanding(input.episodeId),
    sceneRepository.getScenePlans(input.episodeId),
    productionRepository.listShots(input.episodeId),
  ]);
  if ((process.env.LLM_MODE ?? 'mock') === 'mock') {
    const facts = story ? `故事摘要：${story.storyBible.summary}；角色：${story.storyBible.characters.map((character) => character.name).join('、')}。` : '尚无 StoryBible。';
    return { kind: 'answer', intent, text: `${facts} 关于“${input.message}”的创作建议：优先确保人物目标、场次冲突和情绪变化一致；此建议不会直接修改资产。`, data: { sceneCount: scenes?.scenes.length ?? 0, shotCount: shots.length } };
  }
  const response = await chatAgent.generate(
    `【用户问题】${input.message}\n【StoryBible】${JSON.stringify(story?.storyBible ?? null)}\n【Scenes】${JSON.stringify(scenes?.scenes ?? [])}\n【Shots】${JSON.stringify(shots)}`,
    {
      memory: { thread: input.threadId, resource: input.resourceId },
      maxSteps: 2,
    },
  );
  return { kind: 'answer', intent, text: response.text };
}
