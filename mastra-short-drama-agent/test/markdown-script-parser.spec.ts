import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScriptMarkdown } from '../src/domain/markdown-script-parser.ts';

test('解析基础约定式 Markdown：场次、人物、动作、对白和备注', () => {
  const result = parseScriptMarkdown(`# 测试短剧

## 第1场 夜 / 写字楼门口
【人物】林小雨、陈默
【动作】林小雨冲出旋转门。
【对白】陈默：你的合同掉了。
【备注】两人首次相遇。
`);

  assert.equal(result.format, 'basic-markdown');
  assert.equal(result.scenes.length, 1);
  assert.deepEqual(result.scenes[0].characters, ['林小雨', '陈默']);
  assert.deepEqual(result.scenes[0].actions, ['林小雨冲出旋转门。']);
  assert.deepEqual(result.scenes[0].dialogues, ['陈默：你的合同掉了。']);
  assert.equal(result.scenes[0].timeLabel, '夜');
  assert.equal(result.scenes[0].locationLabel, '写字楼门口');
});

test('解析接近行业剧本格式：保留 INT/EXT 后面的完整场景标题', () => {
  const result = parseScriptMarkdown(`1. EXT. 写字楼门口 - 夜
林小雨冲出旋转门。

2. INT. 咖啡馆靠窗位 - 日
陈默端着咖啡寻找位置。
`);

  assert.equal(result.format, 'industry-markdown');
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[0].heading, 'EXT. 写字楼门口 - 夜');
  assert.equal(result.scenes[1].heading, 'INT. 咖啡馆靠窗位 - 日');
});

test('不属于场次的文本会进入 warnings，不会伪造场景', () => {
  const result = parseScriptMarkdown('这是一段没有场次标题的剧本。');
  assert.equal(result.scenes.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('没有识别到场次标题')));
});
