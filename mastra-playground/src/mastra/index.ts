import { Mastra } from "@mastra/core/mastra";

import { calculatorAgent } from "./agents/calculator-agent.ts";

/**
 * Mastra Runtime：本应用的顶层注册中心。
 *
 * Studio、REST API 和其他代码都从这里发现 calculatorAgent。
 */
export const mastra = new Mastra({
 agents: { calculatorAgent },
});
