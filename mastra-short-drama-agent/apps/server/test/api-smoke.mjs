import assert from 'node:assert/strict';

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:4120';
const scriptText = `## 第1场 夜 / 天台\n【人物】林小雨、陈默\n【动作】林小雨看向远处。\n【对白】陈默：你终于来了。`;

const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (path) => fetch(`${base}${path}`);

const projectResponse = await post('/projects', { name: 'API Smoke Project' });
assert.equal(projectResponse.status, 201);
const project = await projectResponse.json();

const episodeResponse = await post(`/projects/${project.id}/episodes`, { episodeNo: 1, title: '第一集' });
assert.equal(episodeResponse.status, 201);
const episode = await episodeResponse.json();

const understandingResponse = await post('/story-understandings', { projectId: project.id, episodeId: episode.id, projectName: project.name, episodeNo: 1, scriptText });
assert.equal(understandingResponse.status, 202);
const job = await understandingResponse.json();
let understanding;
for (let i = 0; i < 20; i++) {
  understanding = await (await get(`/story-understandings/${job.runId}`)).json();
  if (understanding.status === 'done' || understanding.status === 'failed') break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(understanding.status, 'done');
assert.equal((await (await post(`/episodes/${episode.id}/story-bible/confirm`, {})).json()).status, 'confirmed');
const sceneStart = await (await post(`/episodes/${episode.id}/scenes`, {})).json();
assert.equal(sceneStart.status, 'queued');
let sceneJob;
for (let i = 0; i < 20; i++) {
  sceneJob = await (await get(`/scene-plannings/${sceneStart.runId}`)).json();
  if (sceneJob.status === 'done' || sceneJob.status === 'failed') break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(sceneJob.status, 'done');
assert.equal((await (await post(`/episodes/${episode.id}/scenes/confirm`, {})).json()).status, 'confirmed');
const productionStart = await (await post(`/episodes/${episode.id}/production`, { maxRounds: 3, concurrency: 2 })).json();
assert.equal(productionStart.status, 'queued');
let productionJob;
for (let i = 0; i < 30; i++) {
  productionJob = await (await get(`/storyboard-productions/${productionStart.runId}`)).json();
  if (productionJob.status === 'done' || productionJob.status === 'failed') break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(productionJob.status, 'done');
const shots = await (await get(`/episodes/${episode.id}/shots`)).json();
assert.equal(shots.shots.length, 2);
assert.equal((await (await post(`/episodes/${episode.id}/export`, { format: 'json' })).json()).format, 'json');
const chat = await (await post('/chat', { message: '询问人物动机', episodeId: episode.id })).json();
assert.equal(chat.kind, 'answer');
const proposal = await (await post('/change-proposals', { targetType: 'character', targetId: 'c1', changeType: 'clothing', riskLevel: 'high', before: { clothing: '灰色风衣' }, after: { clothing: '白色风衣' }, reason: '测试', impactScope: ['episode:1'] })).json();
assert.equal((await (await post(`/change-proposals/${proposal.id}/approve`, {})).json()).status, 'approved');
assert.equal((await (await post('/feedback', { targetType: 'episode', targetId: episode.id, rating: 5, action: 'accept', comment: 'Smoke test' })).json()).ok, true);
const chatChange = await (await post('/chat', { message: '把角色服装改得更成熟', episodeId: episode.id })).json();
assert.equal(chatChange.intent, 'change-proposal');
assert.equal(chatChange.data.status, 'pending');
console.log(JSON.stringify({ ok: true, projectId: project.id, episodeId: episode.id, shotCount: shots.shots.length }));
