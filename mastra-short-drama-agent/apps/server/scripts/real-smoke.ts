import 'dotenv/config';
import { loadEnvironment, requireRuntimeConfig } from '../src/config.js';
import { parseScriptMarkdown } from '../src/domain/markdown-script-parser.ts';
import { generateStoryBible, generateScenePlans, generateShot, reviewShot } from '../src/nest/llm/agents.ts';

loadEnvironment();
requireRuntimeConfig('worker');
const script = `# 真实模型冒烟测试\n\n## 第1场 夜 / 天台\n【人物】林小雨、老周\n【动作】林小雨攥紧风衣，老周走近。\n【对白】老周：别怕，明天会有答案。\n【对白】林小雨：我会留下。`;
const parsed = parseScriptMarkdown(script);
const bible = await generateStoryBible(parsed, script);
const scenes = await generateScenePlans(parsed, bible.value);
const scene = scenes.value[0];
if (!scene) throw new Error('真实模型未返回场次');
const shots = [];
for (let sequence = 1; sequence <= 4; sequence++) {
  const beat = scene.beats[(sequence - 1) % scene.beats.length];
  const shot = await generateShot(scene, sequence, beat, bible.value);
  const review = await reviewShot(scene, bible.value, shot.value);
  shots.push({ sequence, reviewPassed: review.value.passed, attempts: shot.attempts, model: shot.model });
}
console.log(JSON.stringify({ ok: true, episodeCount: 1, shotCount: shots.length, model: bible.model, shots }, null, 2));
