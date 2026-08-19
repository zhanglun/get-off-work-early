/**
 * Lesson 02：多工具的自主选择。
 *
 * 运行：
 *   pnpm run lesson:02
 *
 * 此 runner 故意不传 toolChoice：模型必须根据用户意图、Agent instructions
 * 和 Tool description，在 addTool / multiplyTool 之间自己选择。
 */
import { mastra } from './mastra/index.ts';

const CASES = [
  {
    name: '加法：应调用 addTool',
    prompt: '12.5 加 7.25 等于多少？',
    expectedToolNames: ['addTool'],
  },
  {
    name: '乘法：应调用 multiplyTool',
    prompt: '6.5 乘以 4 等于多少？',
    expectedToolNames: ['multiplyTool'],
  },
  {
    name: '两步计算：应依次调用 addTool 与 multiplyTool',
    prompt: '(8 加 2) 乘以 3 等于多少？请按运算顺序计算。',
    expectedToolNames: ['addTool', 'multiplyTool'],
  },
  {
    name: '能力边界：不应调用任何工具',
    prompt: '北京今天天气怎么样？',
    expectedToolNames: [],
  },
];

const agent = mastra.getAgentById('calculator-agent');

if (!agent) {
  throw new Error('未找到 calculator-agent；请检查 src/mastra/index.ts 的注册。');
}

let passedCount = 0;
let failedCount = 0;

// 同一 Agent 实例按顺序执行，避免把 provider 限流误判为工具选择错误。
for (const testCase of CASES) {
  try {
    const response = await agent.generate(testCase.prompt, {
      // 多步题允许：模型→add→模型→multiply→模型最终答复。
      maxSteps: 4,
    });
    const actualToolNames = response.toolCalls.map(call => call.payload.toolName);
    const passed = testCase.expectedToolNames.length === actualToolNames.length &&
      testCase.expectedToolNames.every(
        (name, index) => name === actualToolNames[index],
      );

    if (passed) {
      passedCount += 1;
    } else {
      failedCount += 1;
    }

    const lines = [
      `=== ${testCase.name} ===`,
      `问题：${testCase.prompt}`,
      `期望工具：${testCase.expectedToolNames.length === 0 ? '无' : testCase.expectedToolNames.join('、')}`,
      `实际工具：${actualToolNames.length === 0 ? '无' : actualToolNames.join('、')}`,
      `选择验证：${passed ? '通过' : '未通过'}`,
      `最终回答：${response.text}`,
      `结束原因：${response.finishReason}；步骤数：${response.steps.length}`,
    ];

    for (const result of response.toolResults) {
      lines.push(
        `工具结果：${result.payload.toolName} → ${JSON.stringify(result.payload.result)}`,
      );
    }

    lines.push(`Token Usage：${JSON.stringify(response.usage)}`);
    console.info(lines.join('\n'));
  } catch (error) {
    failedCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `=== ${testCase.name} ===\n` +
        `调用失败：${message}\n` +
        '请确认 ZHIPU_API_KEY 已配置；若上游返回 429，请稍后重试。',
    );
  }
}

console.info(`=== Lesson 02 汇总：通过 ${passedCount}/${CASES.length}；失败 ${failedCount}/${CASES.length} ===`);

if (failedCount > 0) {
  process.exitCode = 1;
}
