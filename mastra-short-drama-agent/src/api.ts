import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mastra } from './mastra/index.ts';
import { taskInputSchema } from './domain/schemas.ts';
import { storyboardStore } from './domain/store.ts';
import { storyRepository } from './domain/story-repository.ts';
import { sceneRepository } from './domain/scene-repository.ts';
import { projectRepository } from './domain/project-repository.ts';
import { storyboardProductionInputSchema } from './domain/production-schemas.ts';
import { productionRepository } from './domain/production-repository.ts';
import { exportEpisode } from './domain/export-service.ts';
import { changeProposalSchema } from './domain/production-schemas.ts';
import { handleChat } from './domain/chat-service.ts';
import { collectDiff } from './domain/version-diff.ts';
import { storyUnderstandingInputSchema } from './domain/story-schemas.ts';
import { scenePlanningInputSchema } from './domain/scene-schemas.ts';
import { taskRepository } from './domain/task-repository.ts';

interface UnderstandingJob {
  runId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  episodeId?: string;
  error?: string;
}

const understandingJobs = new Map<string, UnderstandingJob>();
const sceneJobs = new Map<string, UnderstandingJob>();
const productionJobs = new Map<string, UnderstandingJob>();

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function startProduction(input: ReturnType<typeof storyboardProductionInputSchema.parse>, runId: string) {
  const job = productionJobs.get(runId);
  if (!job) return;
  job.status = 'running';
  await taskRepository.update(runId, { status: 'running' });
  try {
    const workflow = mastra.getWorkflow('storyboardProductionWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: input });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    job.status = 'done';
    job.episodeId = input.episodeId;
    await taskRepository.update(runId, { status: 'done', outputRef: input.episodeId, progress: { done: 1, total: 1 } });
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    await taskRepository.update(runId, { status: 'failed', error: String(error) });
  }
}

async function startScenePlanning(episodeId: string, runId: string) {
  const job = sceneJobs.get(runId);
  if (!job) return;
  job.status = 'running';
  await taskRepository.update(runId, { status: 'running' });
  try {
    const workflow = mastra.getWorkflow('scenePlanningWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { episodeId } });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    job.status = 'done';
    job.episodeId = episodeId;
    await taskRepository.update(runId, { status: 'done', outputRef: episodeId, progress: { done: 1, total: 1 } });
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    await taskRepository.update(runId, { status: 'failed', error: String(error) });
  }
}

async function startStoryUnderstanding(input: ReturnType<typeof storyUnderstandingInputSchema.parse>, runId: string) {
  const job = understandingJobs.get(runId);
  if (!job) return;
  job.status = 'running';
  await taskRepository.update(runId, { status: 'running' });
  try {
    const workflow = mastra.getWorkflow('storyUnderstandingWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: input });
    if (result.status !== 'success') throw new Error(JSON.stringify(result));
    job.status = 'done';
    job.episodeId = result.result.episodeId;
    await taskRepository.update(runId, { status: 'done', outputRef: result.result.episodeId, progress: { done: 1, total: 1 } });
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    await taskRepository.update(runId, { status: 'failed', error: String(error) });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8'));
      return;
    }
    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
    const episodeCreateMatch = url.pathname.match(/^\/projects\/([^/]+)\/episodes$/);
    const jobMatch = url.pathname.match(/^\/story-understandings\/([^/]+)$/);
    const bibleMatch = url.pathname.match(/^\/episodes\/([^/]+)\/story-bible$/);
    const confirmMatch = url.pathname.match(/^\/episodes\/([^/]+)\/story-bible\/confirm$/);
    const sceneMatch = url.pathname.match(/^\/episodes\/([^/]+)\/scenes$/);
    const sceneConfirmMatch = url.pathname.match(/^\/episodes\/([^/]+)\/scenes\/confirm$/);
    const sceneJobMatch = url.pathname.match(/^\/scene-plannings\/([^/]+)$/);
    const productionMatch = url.pathname.match(/^\/episodes\/([^/]+)\/production$/);
    const productionJobMatch = url.pathname.match(/^\/storyboard-productions\/([^/]+)$/);
    const shotsMatch = url.pathname.match(/^\/episodes\/([^/]+)\/shots$/);
    const shotVersionsMatch = url.pathname.match(/^\/episodes\/([^/]+)\/shots\/(\d+)\/(\d+)\/(versions|reviews|diff|regenerate)$/);
    const exportMatch = url.pathname.match(/^\/episodes\/([^/]+)\/export$/);
    const proposalMatch = url.pathname.match(/^\/change-proposals\/([^/]+)(?:\/(approve|reject))?$/);
    if (request.method === 'POST' && url.pathname === '/chat') {
      const body = await readJson(request);
      return send(response, 200, await handleChat(body));
    }

    if (request.method === 'POST' && url.pathname === '/projects') {
      const body = await readJson(request) as Record<string, unknown>;
      if (typeof body.name !== 'string' || body.name.trim().length === 0) return send(response, 400, { error: 'name 必须是非空字符串' });
      const project = await projectRepository.createProject({ id: randomUUID(), name: body.name, description: typeof body.description === 'string' ? body.description : undefined });
      return send(response, 201, project);
    }

    if (request.method === 'POST' && episodeCreateMatch) {
      const body = await readJson(request) as Record<string, unknown>;
      const episodeNo = body.episodeNo;
      if (typeof episodeNo !== 'number' || !Number.isInteger(episodeNo) || episodeNo < 1) return send(response, 400, { error: 'episodeNo 必须是正整数' });
      const episode = await projectRepository.createEpisode({ id: randomUUID(), projectId: episodeCreateMatch[1], episodeNo, title: typeof body.title === 'string' ? body.title : undefined });
      return send(response, 201, episode);
    }

    if (request.method === 'POST' && url.pathname === '/story-understandings') {
      const body = await readJson(request);
      const parsed = storyUnderstandingInputSchema.safeParse(body);
      if (!parsed.success) return send(response, 400, { error: parsed.error.issues });
      const runId = randomUUID();
      understandingJobs.set(runId, { runId, status: 'queued' });
      await taskRepository.create({ id: runId, kind: 'story-understanding', status: 'queued', progress: { done: 0, total: 1 }, inputRef: parsed.data.episodeId ?? parsed.data.projectId });
      void startStoryUnderstanding(parsed.data, runId);
      return send(response, 202, { runId, status: 'queued' });
    }

    if (request.method === 'POST' && sceneMatch && !sceneConfirmMatch) {
      const parsed = scenePlanningInputSchema.safeParse({ episodeId: sceneMatch[1] });
      if (!parsed.success) return send(response, 400, { error: parsed.error.issues });
      const runId = randomUUID();
      sceneJobs.set(runId, { runId, status: 'queued', episodeId: parsed.data.episodeId });
      await taskRepository.create({ id: runId, kind: 'scene-planning', status: 'queued', progress: { done: 0, total: 1 }, inputRef: parsed.data.episodeId });
      void startScenePlanning(parsed.data.episodeId, runId);
      return send(response, 202, { runId, status: 'queued', episodeId: parsed.data.episodeId });
    }

    if (request.method === 'POST' && productionMatch) {
      const body = await readJson(request) as Record<string, unknown>;
      const parsed = storyboardProductionInputSchema.safeParse({
        episodeId: productionMatch[1],
        maxRounds: body.maxRounds,
        concurrency: body.concurrency,
      });
      if (!parsed.success) return send(response, 400, { error: parsed.error.issues });
      const runId = randomUUID();
      productionJobs.set(runId, { runId, status: 'queued', episodeId: parsed.data.episodeId });
      await taskRepository.create({ id: runId, kind: 'storyboard-production', status: 'queued', progress: { done: 0, total: 1 }, inputRef: parsed.data.episodeId });
      void startProduction(parsed.data, runId);
      return send(response, 202, { runId, status: 'queued', episodeId: parsed.data.episodeId });
    }

    if (request.method === 'GET' && productionJobMatch) {
      const job = await taskRepository.get(productionJobMatch[1]);
      if (!job) return send(response, 404, { error: '分镜生产任务不存在' });
      return send(response, 200, job);
    }

    if (request.method === 'POST' && shotVersionsMatch && shotVersionsMatch[4] === 'regenerate') {
      const input = storyboardProductionInputSchema.parse({
        episodeId: shotVersionsMatch[1],
        maxRounds: 3,
        concurrency: 1,
        shotSequences: [{ sceneNo: Number(shotVersionsMatch[2]), sequence: Number(shotVersionsMatch[3]) }],
      });
      const runId = randomUUID();
      productionJobs.set(runId, { runId, status: 'queued', episodeId: input.episodeId });
      await taskRepository.create({ id: runId, kind: 'shot-regeneration', status: 'queued', progress: { done: 0, total: 1 }, inputRef: input.episodeId });
      void startProduction(input, runId);
      return send(response, 202, { runId, status: 'queued', shot: input.shotSequences?.[0] });
    }

    if (request.method === 'GET' && shotVersionsMatch && (shotVersionsMatch[4] === 'versions' || shotVersionsMatch[4] === 'reviews' || shotVersionsMatch[4] === 'diff')) {
      const shots = await productionRepository.listShots(shotVersionsMatch[1]);
      const shot = shots.find((item) => item.sceneNo === Number(shotVersionsMatch[2]) && item.sequence === Number(shotVersionsMatch[3]));
      if (!shot) return send(response, 404, { error: '镜头不存在' });
      if (shotVersionsMatch[4] === 'reviews') return send(response, 200, shot.reviews);
      const versions = await productionRepository.listPromptVersions(shotVersionsMatch[1], Number(shotVersionsMatch[2]), Number(shotVersionsMatch[3]));
      if (shotVersionsMatch[4] === 'versions') return send(response, 200, versions);
      const byKind: Record<string, typeof versions> = {};
      for (const version of versions) (byKind[version.kind] ??= []).push(version);
      const diffs = Object.fromEntries(Object.entries(byKind).map(([kind, values]) => {
        const list = values ?? [];
        const latest = list.at(-1);
        const previous = list.at(-2);
        return [kind, { versions: list, diff: previous && latest ? collectDiff(previous, latest) : [] }];
      }));
      return send(response, 200, diffs);
    }

    if (request.method === 'GET' && shotsMatch) {
      const shots = await productionRepository.listShots(shotsMatch[1]);
      return send(response, 200, { episodeId: shotsMatch[1], shots });
    }

    if (request.method === 'POST' && exportMatch) {
      const body = await readJson(request) as Record<string, unknown>;
      const format = body.format === 'json' ? 'json' : 'markdown';
      return send(response, 200, await exportEpisode(exportMatch[1], format));
    }

    if (request.method === 'POST' && url.pathname === '/change-proposals') {
      const body = await readJson(request);
      const parsed = changeProposalSchema.safeParse({
        ...(body as Record<string, unknown>),
        id: randomUUID(),
        status: 'pending',
      });
      if (!parsed.success) return send(response, 400, { error: parsed.error.issues });
      await productionRepository.createChangeProposal(parsed.data);
      return send(response, 201, parsed.data);
    }

    if (request.method === 'GET' && proposalMatch) {
      const proposal = await productionRepository.getChangeProposal(proposalMatch[1]);
      if (!proposal) return send(response, 404, { error: '变更提议不存在' });
      return send(response, 200, proposal);
    }

    if (request.method === 'POST' && proposalMatch && proposalMatch[2] === 'approve') {
      const proposal = await productionRepository.decideChangeProposal(proposalMatch[1], 'approved');
      return send(response, 200, proposal);
    }

    if (request.method === 'POST' && proposalMatch && proposalMatch[2] === 'reject') {
      const proposal = await productionRepository.decideChangeProposal(proposalMatch[1], 'rejected');
      return send(response, 200, proposal);
    }

    if (request.method === 'POST' && url.pathname === '/feedback') {
      const body = await readJson(request) as Record<string, unknown>;
      if (typeof body.targetType !== 'string' || typeof body.targetId !== 'string') return send(response, 400, { error: 'targetType 和 targetId 必须是字符串' });
      await productionRepository.saveFeedback({
        targetType: body.targetType,
        targetId: body.targetId,
        rating: typeof body.rating === 'number' ? body.rating : undefined,
        action: typeof body.action === 'string' ? body.action : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
        createdBy: typeof body.createdBy === 'string' ? body.createdBy : undefined,
      });
      return send(response, 201, { ok: true });
    }

    if (request.method === 'GET' && sceneJobMatch) {
      const job = await taskRepository.get(sceneJobMatch[1]);
      if (!job) return send(response, 404, { error: 'Scene 规划任务不存在' });
      return send(response, 200, job);
    }

    if (request.method === 'GET' && sceneMatch) {
      const result = await sceneRepository.getScenePlans(sceneMatch[1]);
      if (!result) return send(response, 404, { error: 'Scene 规划不存在' });
      return send(response, 200, result);
    }

    if (request.method === 'POST' && sceneConfirmMatch) {
      const result = await sceneRepository.confirmScenePlans(sceneConfirmMatch[1]);
      return send(response, 200, result);
    }

    if (request.method === 'GET' && jobMatch) {
      const job = await taskRepository.get(jobMatch[1]);
      if (!job) return send(response, 404, { error: '理解任务不存在' });
      return send(response, 200, job);
    }

    if (request.method === 'GET' && bibleMatch) {
      const result = await storyRepository.getStoryUnderstanding(bibleMatch[1]);
      if (!result) return send(response, 404, { error: 'StoryBible 不存在' });
      return send(response, 200, result);
    }

    if (request.method === 'POST' && confirmMatch) {
      const current = await storyRepository.getStoryUnderstanding(confirmMatch[1]);
      if (!current) return send(response, 404, { error: 'StoryBible 不存在' });
      try {
        const result = await storyRepository.confirmStoryBible(confirmMatch[1]);
        return send(response, 200, result);
      } catch (error) {
        return send(response, 409, { error: String(error) });
      }
    }

    // 保留之前的分镜 Spike API，供回归验证使用。
    if (request.method === 'POST' && url.pathname === '/tasks') {
      const body = await readJson(request);
      const parsed = taskInputSchema.safeParse({
        ...(body as Record<string, unknown>),
        taskId: randomUUID(),
      });
      if (!parsed.success) return send(response, 400, { error: parsed.error.issues });
      storyboardStore.createTask(parsed.data);
      void (async () => {
        const workflow = mastra.getWorkflow('storyboardWorkflow');
        const run = await workflow.createRun();
        const result = await run.start({ inputData: parsed.data });
        if (result.status !== 'success') {
          storyboardStore.update(parsed.data.taskId, { status: 'failed', error: JSON.stringify(result) });
        }
      })();
      return send(response, 202, { taskId: parsed.data.taskId, status: 'queued' });
    }

    if (request.method === 'GET' && taskMatch) {
      const domainTask = await taskRepository.get(taskMatch[1]);
      if (domainTask) return send(response, 200, domainTask);
      return send(response, 200, storyboardStore.getTask(taskMatch[1]));
    }
    return send(response, 404, { error: 'Not Found' });
  } catch (error) {
    return send(response, 500, { error: String(error) });
  }
});

const port = Number(process.env.PORT ?? 4120);
server.listen(port, () => console.log(`Short Drama API listening on http://localhost:${port}`));
