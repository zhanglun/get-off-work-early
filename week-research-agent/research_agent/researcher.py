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
from common.tools import search_web, fetch_url, query_docs
from common.schemas import TOOLS_SCHEMA
from common.state import ToolCallRecord
from research_agent.prompts import RESEARCHER_SYSTEM_PROMPT
from research_agent.state import ResearchState


# 研究阶段允许的工具：
# - search_web：搜互联网（公开信息）
# - fetch_url：读网页全文（深度）
# - query_docs：查本地知识库（私有文档，RAG）
RESEARCH_TOOL_REGISTRY = {
    "search_web": search_web,
    "fetch_url": fetch_url,
    "query_docs": query_docs,
}

# 只把研究相关工具的 schema 给 LLM（少而精）
RESEARCH_TOOL_NAMES = {"search_web", "fetch_url", "query_docs"}
RESEARCH_TOOLS_SCHEMA = [t for t in TOOLS_SCHEMA if t["function"]["name"] in RESEARCH_TOOL_NAMES]


def run_research(state: ResearchState, client: ZhipuAI, logger: logging.Logger,
                 max_steps: int = 8, history: list = None,
                 on_progress=None) -> ResearchState:
    """
    阶段 A：研究循环。

    参数：
        state:       ResearchState（外部创建，topic 已设好）
        client:      ZhipuAI 客户端（外部传入，复用连接）
        logger:      日志器
        max_steps:   最大搜索轮次
        history:     历史对话 messages（Day 8 Session Memory）。
        on_progress: 进度回调（Day 9 Streaming）。
                     每个关键步骤调用，传入事件 dict，外部据此推送 SSE。
    返回：
        更新后的 state（findings 字段被填充）
    """

    def _emit(event: dict):
        """安全地触发进度回调（没有回调时啥也不做）。"""
        if on_progress:
            try:
                on_progress(event)
            except Exception:
                pass  # 回调失败不能影响 Agent 主流程

    logger.info(f"🔍 阶段 A 开始研究：{state.topic}")
    _emit({"event": "phase", "phase": "research", "topic": state.topic})

    # 构建消息列表：System Prompt + [历史对话] + 本次课题
    # 关键：历史对话插在 system 和本次 user 之间，让 LLM 有上下文
    state.messages = [
        {"role": "system", "content": RESEARCHER_SYSTEM_PROMPT},
    ]
    if history:
        state.messages.extend(history)
        logger.info(f"📚 已加载 {len(history)} 条历史消息")
        _emit({"event": "history", "count": len(history)})
    state.messages.append(
        {"role": "user", "content": f"请研究以下课题：{state.topic}"},
    )

    try:
        # 第 1 轮：发课题 + 工具清单
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=state.messages,
            tools=RESEARCH_TOOLS_SCHEMA,
            temperature=Config.TEMPERATURE,
        )
        state.add_usage(response.usage)  # Day 10 token 统计
        message = response.choices[0].message

        while message.tool_calls:
            # 防死循环
            if not state.can_continue():
                state.status = "max_steps_reached"
                logger.warning(f"⚠️ 达到最大步数 {state.max_steps}，停止搜索")
                _emit({"event": "max_steps", "max_steps": state.max_steps})
                break

            state.steps += 1
            logger.info(f"--- 第 {state.steps} 轮 ---")
            _emit({"event": "step", "step": state.steps})
            state.messages.append(message.model_dump())

            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                # 不同工具打印不同的日志（语义清晰）
                if fn_name == "search_web":
                    logger.info(f"🔎 搜索：{args.get('query', '?')}")
                    _emit({"event": "tool_start", "tool": "search_web",
                           "query": args.get('query', '?')})
                elif fn_name == "fetch_url":
                    url = args.get('url', '?')[:60]
                    logger.info(f"📖 读全文：{url}")
                    _emit({"event": "tool_start", "tool": "fetch_url", "url": url})
                elif fn_name == "query_docs":
                    logger.info(f"📚 查知识库：{args.get('question', '?')}")
                    _emit({"event": "tool_start", "tool": "query_docs",
                           "question": args.get('question', '?')})
                else:
                    logger.info(f"🔧 调用：{fn_name}({args})")
                    _emit({"event": "tool_start", "tool": fn_name, "args": args})

                # 执行工具（都自带 @retry_with_timeout）
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
                # 不同工具的"结果规模"指标不同
                if fn_name == "search_web":
                    cnt = result.get("count", 0)
                    logger.info(f"   {ok} 找到 {cnt} 条结果（{elapsed:.1f}s）")
                    _emit({"event": "tool_end", "tool": "search_web",
                           "success": result.get("success", False),
                           "count": cnt, "elapsed": round(elapsed, 1)})
                elif fn_name == "fetch_url":
                    length = result.get("length", 0)
                    truncated = "（已截断）" if result.get("truncated") else ""
                    logger.info(f"   {ok} 正文 {length} 字符{truncated}（{elapsed:.1f}s）")
                    _emit({"event": "tool_end", "tool": "fetch_url",
                           "success": result.get("success", False),
                           "length": length, "elapsed": round(elapsed, 1)})
                elif fn_name == "query_docs":
                    cnt = result.get("count", 0)
                    sources = result.get("sources", [])
                    logger.info(f"   {ok} 检索到 {cnt} 块（来源 {sources}）（{elapsed:.1f}s）")
                    _emit({"event": "tool_end", "tool": "query_docs",
                           "success": result.get("success", False),
                           "count": cnt, "sources": sources,
                           "elapsed": round(elapsed, 1)})
                else:
                    logger.info(f"   {ok} 完成（{elapsed:.1f}s）")
                    _emit({"event": "tool_end", "tool": fn_name,
                           "success": result.get("success", False),
                           "elapsed": round(elapsed, 1)})

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
            state.add_usage(response.usage)  # Day 10 token 统计
            message = response.choices[0].message

        # 循环结束：LLM 不再要工具，给出阶段 A 的小结
        if state.status == "running":
            state.status = "finished"
        state.final_answer = message.content or ""

        # 把对话过程中的搜索结果整理成 findings 文本，喂给阶段 B
        state.findings = _extract_findings(state)
        logger.info(f"📝 阶段 A 完成：搜索 {state.steps} 轮，素材 {len(state.findings)} 字符")
        _emit({"event": "phase_done", "phase": "research",
               "steps": state.steps, "findings_length": len(state.findings)})

    except Exception as e:
        state.status = "error"
        state.error = f"研究阶段出错：{type(e).__name__}: {e}"
        logger.error(f"❌ {state.error}")
        _emit({"event": "error", "phase": "research", "error": state.error})

    return state


def _extract_findings(state: ResearchState) -> str:
    """
    从 state 中提取所有搜索 + 抓取结果，整理成结构化文本素材。

    【为什么不直接把 messages 给阶段 B？】
    messages 里有大量无关内容（system prompt、assistant 思考过程、tool_call 元数据）。
    阶段 B 只需要"搜索到了什么 + 读到了什么"。提取成干净的文本，token 更省、效果更好。

    【两类素材的分工】
    - search_web 结果：广度线索（每条 300 字摘要）
    - fetch_url 结果：深度内容（单篇文章几千字正文）
    """
    # 取所有成功的工具调用，按时间顺序（step）
    useful_records = [tc for tc in state.tool_history
                      if tc.success and tc.tool_name in ("search_web", "fetch_url")]

    if not useful_records:
        return "(本次研究未获得有效搜索结果)"

    lines = []
    search_idx = 0
    fetch_idx = 0

    for tc in useful_records:
        result = tc.result
        if not isinstance(result, dict):
            continue

        if tc.tool_name == "search_web":
            search_idx += 1
            query = tc.arguments.get("query", "?")
            lines.append(f"【搜索 {search_idx}】关键词：{query}")
            for j, item in enumerate(result.get("results", []), 1):
                title = item.get("title", "")
                content = item.get("content", "")
                link = item.get("link", "")
                lines.append(f"  {j}. {title}")
                if content:
                    lines.append(f"     {content}")
                if link:
                    lines.append(f"     来源：{link}")
            lines.append("")

        elif tc.tool_name == "fetch_url":
            fetch_idx += 1
            url = tc.arguments.get("url", "?")
            title = result.get("title", "")
            content = result.get("content", "")
            lines.append(f"【深度阅读 {fetch_idx}】{title}")
            lines.append(f"  来源：{url}")
            lines.append(f"  正文：{content}")
            lines.append("")

    # 附上 LLM 在阶段 A 末尾给的小结（如果有）
    if state.final_answer:
        lines.append(f"【研究助手的小结】\n{state.final_answer}")

    return "\n".join(lines)
