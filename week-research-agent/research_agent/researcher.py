"""
阶段 A：研究循环（researcher）。

【职责】
拿到课题后，自主多轮搜索，收集素材。这一阶段：
- 有 System Prompt（"你是研究助手"）
- 允许调用 search_web（普通模式，自然语言思考）
- 不要求结构化输出（避免 Day 4 踩坑 3 的"格式压力让 LLM 跳过工具"）

【和 Day 4 Agent Loop 的区别】
Day 4 的 Loop 没有 System Prompt，被动回答。
Day 5 的 researcher 加了 System Prompt，Agent 会主动拆解课题、规划搜索。

【产出】
更新 state.findings —— 把所有搜索结果整理成文本，喂给阶段 B。
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
import logging
from config import Config
from common.tools import search_web
from common.schemas import TOOLS_SCHEMA
from common.state import ToolCallRecord
from research_agent.prompts import RESEARCHER_SYSTEM_PROMPT
from research_agent.state import ResearchState


# 研究阶段只允许搜索（加法/读文件对"研究"没意义，避免 LLM 误用）
RESEARCH_TOOL_REGISTRY = {
    "search_web": search_web,
}

# 只把 search_web 的 schema 给 LLM（少而精，降低选择困难）
RESEARCH_TOOLS_SCHEMA = [t for t in TOOLS_SCHEMA if t["function"]["name"] == "search_web"]


def run_research(state: ResearchState, client: ZhipuAI, logger: logging.Logger,
                 max_steps: int = 8) -> ResearchState:
    """
    阶段 A：研究循环。

    参数：
        state:     ResearchState（外部创建，topic 已设好）
        client:    ZhipuAI 客户端（外部传入，复用连接）
        logger:    日志器
        max_steps: 最大搜索轮次
    返回：
        更新后的 state（findings 字段被填充）
    """
    logger.info(f"🔍 阶段 A 开始研究：{state.topic}")

    # System Prompt + 用户课题
    state.messages = [
        {"role": "system", "content": RESEARCHER_SYSTEM_PROMPT},
        {"role": "user", "content": f"请研究以下课题：{state.topic}"},
    ]

    try:
        # 第 1 轮：发课题 + 工具清单
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=state.messages,
            tools=RESEARCH_TOOLS_SCHEMA,
            temperature=Config.TEMPERATURE,
        )
        message = response.choices[0].message

        while message.tool_calls:
            # 防死循环
            if not state.can_continue():
                state.status = "max_steps_reached"
                logger.warning(f"⚠️ 达到最大步数 {state.max_steps}，停止搜索")
                break

            state.steps += 1
            logger.info(f"--- 搜索第 {state.steps} 轮 ---")
            state.messages.append(message.model_dump())

            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                logger.info(f"🔎 搜索关键词：{args.get('query', '?')}")

                # 执行搜索（search_web 自带 @retry_with_timeout）
                import time
                start = time.time()
                if fn_name not in RESEARCH_TOOL_REGISTRY:
                    result = {"success": False, "result": f"研究阶段不支持工具：{fn_name}"}
                else:
                    result = RESEARCH_TOOL_REGISTRY[fn_name](**args)
                elapsed = time.time() - start

                state.add_tool_call(ToolCallRecord(
                    step=state.steps, tool_name=fn_name, arguments=args,
                    result=result, elapsed=elapsed,
                    success=result.get("success", False),
                ))

                ok = "✓" if result.get("success") else "✗"
                cnt = result.get("count", 0)
                logger.info(f"   {ok} 找到 {cnt} 条结果（{elapsed:.1f}s）")

                # 回传给 LLM
                state.messages.append({
                    "role": "tool",
                    "content": json.dumps(result, ensure_ascii=False),
                    "tool_call_id": tool_call.id,
                })

            # 再问 LLM，看还要不要继续搜
            response = client.chat.completions.create(
                model=Config.MODEL,
                messages=state.messages,
                tools=RESEARCH_TOOLS_SCHEMA,
                temperature=Config.TEMPERATURE,
            )
            message = response.choices[0].message

        # 循环结束：LLM 不再要工具，给出阶段 A 的小结
        if state.status == "running":
            state.status = "finished"
        state.final_answer = message.content or ""

        # 把对话过程中的搜索结果整理成 findings 文本，喂给阶段 B
        state.findings = _extract_findings(state)
        logger.info(f"📝 阶段 A 完成：搜索 {state.steps} 轮，素材 {len(state.findings)} 字符")

    except Exception as e:
        state.status = "error"
        state.error = f"研究阶段出错：{type(e).__name__}: {e}"
        logger.error(f"❌ {state.error}")

    return state


def _extract_findings(state: ResearchState) -> str:
    """
    从 state 中提取所有搜索结果，整理成结构化文本素材。

    【为什么不直接把 messages 给阶段 B？】
    messages 里有大量无关内容（system prompt、assistant 思考过程、tool_call 元数据）。
    阶段 B 只需要"搜索到了什么"。提取成干净的文本，token 更省、效果更好。
    """
    search_records = [tc for tc in state.tool_history
                      if tc.tool_name == "search_web" and tc.success]

    if not search_records:
        return "(本次研究未获得有效搜索结果)"

    lines = []
    for i, tc in enumerate(search_records, 1):
        query = tc.arguments.get("query", "?")
        lines.append(f"【搜索 {i}】关键词：{query}")
        result = tc.result
        if isinstance(result, dict) and "results" in result:
            for j, item in enumerate(result["results"], 1):
                title = item.get("title", "")
                content = item.get("content", "")
                link = item.get("link", "")
                lines.append(f"  {j}. {title}")
                if content:
                    lines.append(f"     {content}")
                if link:
                    lines.append(f"     来源：{link}")
        lines.append("")

    # 附上 LLM 在阶段 A 末尾给的小结（如果有）
    if state.final_answer:
        lines.append(f"【研究助手的小结】\n{state.final_answer}")

    return "\n".join(lines)
