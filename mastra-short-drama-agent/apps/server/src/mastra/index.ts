import { Mastra } from '@mastra/core/mastra';
import { storyboardWorkflow } from '../workflows/storyboard-workflow.ts';
import { storyUnderstandingWorkflow } from '../workflows/story-understanding-workflow.ts';
import { scenePlanningWorkflow } from '../workflows/scene-planning-workflow.ts';
import { directorAgent, refinerAgent, reviewerAgent } from '../agents/storyboard-agents.ts';
import { storyboardDirectorAgent, continuityReviewerAgent, promptRefinerAgent } from '../agents/production-agents.ts';
import { scenePlannerAgent } from '../agents/scene-planner-agent.ts';
import { chatAgent } from '../agents/chat-agent.ts';
import { scriptAnalystAgent } from '../agents/script-analyst-agent.ts';
import { storyboardProductionWorkflow } from '../workflows/storyboard-production-workflow.ts';
import { mastraStorage } from './runtime-storage.ts';

export const mastra = new Mastra({
  agents: {
    directorAgent,
    reviewerAgent,
    refinerAgent,
    scriptAnalystAgent,
    scenePlannerAgent,
    storyboardDirectorAgent,
    continuityReviewerAgent,
    promptRefinerAgent,
    chatAgent,
  },
  workflows: {
    storyboardWorkflow,
    storyUnderstandingWorkflow,
    scenePlanningWorkflow,
    storyboardProductionWorkflow,
  },
  ...(mastraStorage ? { storage: mastraStorage } : {}),
  server: {
    port: Number(process.env.PORT ?? 4111),
  },
});
