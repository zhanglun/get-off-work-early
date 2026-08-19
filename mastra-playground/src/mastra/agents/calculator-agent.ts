import { Agent } from "@mastra/core/agent";

import { addTool } from "../tools/add-tool.ts";
import { multiplyTool } from "../tools/multiply-tool.ts";

/**
 * Lesson 02：多工具自主选择。
 *
 * 模型必须根据用户请求、instructions 与 Tool description，在加法和乘法之间
 * 自主选择正确工具；不再由 runner 通过 toolChoice 强制指定。
 */
export const calculatorAgent = new Agent({
 id: "calculator-agent",
 name: "Calculator Agent",
 instructions: `
你是一个严谨的中文计算助手。

规则：
- 当用户询问加法时，必须调用 addTool；当用户询问乘法时，必须调用 multiplyTool。不能自行心算或猜测。
- 涉及多步算术时，按需要依次调用工具；不要把工具结果当作心算结果重写。
- 拿到工具结果后，用中文简洁回答，并明确写出算式和结果。
- 如果请求不是加法或乘法，说明本 Lesson 只支持这两种运算，不要调用工具。
`,
 model: "zhipuai/glm-4.7-flash",
 tools: { addTool, multiplyTool },
});
