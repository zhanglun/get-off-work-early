"""Generate two blueprint-style SVG architecture diagrams for week-research-agent.

Artifacts:
- research-agent-current-architecture.svg: current, implemented architecture
- research-agent-langgraph-target-architecture.svg: LangGraph migration target
"""
from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).parent
W, H = 1800, 1280
FONT = "'Courier New', 'Microsoft YaHei', 'PingFang SC', monospace"

# 图表展示文案统一中文化；代码目录、类名和 API 名保持原样，便于读图后定位源码。
CN = {
    "WEEK-RESEARCH-AGENT · CURRENT IMPLEMENTED ARCHITECTURE": "WEEK-RESEARCH-AGENT · 当前已实现架构",
    "手写 Function Calling Agent + RAG + Session Memory + Workflow + SSE · 代码模块与主要数据流": "手写函数调用 Agent + RAG + 会话记忆 + 工作流 + SSE · 代码模块与主要数据流",
    "WEEK-RESEARCH-AGENT · LANGGRAPH TARGET ARCHITECTURE": "WEEK-RESEARCH-AGENT · LangGraph 目标架构",
    "迁移设计图（尚未落地）· 复用现有工具、RAG、Memory 与 HTTP 层，用 StateGraph 显式编排状态、循环与路由": "迁移设计图（尚未落地）· 复用现有工具、RAG、记忆与 HTTP 层，用 StateGraph 显式编排状态、循环与路由",
    "01 ENTRY & DELIVERY": "01 接入与交付层", "02 SINGLE-TOPIC AGENT RUNTIME": "02 单课题 Agent 运行时", "03 EXTERNAL KNOWLEDGE & TOOLS": "03 外部知识与工具",
    "04 STATE, MEMORY & RAG FOUNDATION": "04 状态、记忆与 RAG 基础", "05 SCALE, QUALITY & LEARNING ADAPTERS": "05 扩展、质量与学习适配",
    "01 UNCHANGED DELIVERY LAYER": "01 保持不变的交付层", "02 LANGGRAPH SINGLE-TOPIC RESEARCH GRAPH": "02 LangGraph 单课题研究图", "03 REUSED CAPABILITIES": "03 复用能力",
    "04 STATE PERSISTENCE & OBSERVABILITY": "04 状态持久化与可观测性", "05 LANGGRAPH LARGE-TOPIC WORKFLOW GRAPH": "05 LangGraph 大课题工作流图",
    "server/ · HTTP API / Browser UI / SSE": "server/ · HTTP API / 浏览器界面 / SSE", "research_agent/ · two-phase architecture: research → structured report": "research_agent/ · 两阶段架构：研究 → 结构化报告",
    "common/tools.py · public web + private knowledge retrieval": "common/tools.py · 公网搜索 + 私有知识检索", "messages / tool trace / token usage / persistent session / vector retrieval": "消息 / 工具追踪 / Token 用量 / 持久会话 / 向量检索",
    "large-topic workflow / evaluation / LangChain comparison": "大课题工作流 / 评估 / LangChain 对照", "existing server/ remains the entry point": "保留现有 server/ 作为接入入口",
    "langgraph_version/ · StateGraph nodes + conditional edges + ToolNode": "langgraph_version/ · StateGraph 节点 + 条件边 + ToolNode", "existing modules are adapters, not rewrites": "现有模块作为适配器复用，不推倒重写",
    "separate conversation memory from graph execution checkpoints": "区分对话记忆与图执行检查点", "Planner fan-out via Send → subgraph research × N → Synthesizer": "Planner 经 Send 扇出 → 子图研究 × N → Synthesizer 汇总",
    "Browser UI": "浏览器界面", "FastAPI": "FastAPI 服务", "HTTP Contract": "HTTP 契约", "Orchestrator": "总编排器", "Researcher Loop": "研究者循环", "Reporter": "报告生成器",
    "GLM Adapter": "GLM 适配器", "Prompt Contract": "提示词契约", "Web Tools": "联网工具", "Private RAG Tool": "私有 RAG 工具", "Tool Reliability & Schemas": "工具可靠性与 Schema", "Internet": "互联网",
    "Agent State": "Agent 状态", "Session Memory": "会话记忆", "Observability": "可观测性", "Knowledge Source": "知识来源", "RAG Pipeline": "RAG 流水线", "Vector Store": "向量库",
    "Standalone RAG Q&A": "独立 RAG 问答", "Large-topic Workflow": "大课题工作流", "Evaluation": "评估", "LangChain Comparison": "LangChain 对照", "Shared Configuration": "共享配置",
    "FastAPI Adapter": "FastAPI 适配器", "API Contract": "API 契约", "Graph Input": "图输入", "Graph State": "图状态", "Router": "路由器", "Safety & Runtime Guardrails": "安全与运行时护栏",
    "LLM Adapter": "LLM 适配器", "Tool Adapters": "工具适配器", "RAG Reuse": "RAG 复用", "Prompts & Schema": "提示词与 Schema", "Existing Manual Agent Is Retained": "保留现有手写 Agent",
    "Conversation Memory": "对话记忆", "Graph Checkpointer": "图检查点", "Streaming & Trace": "流式输出与追踪", "planner Node": "planner 节点", "Send Fan-out": "Send 扇出", "Research Subgraph": "研究子图",
    "researcher_model": "researcher_model", "ToolNode": "ToolNode", "collect_findings": "collect_findings", "reporter": "reporter", "synthesizer": "synthesizer",
    "server/static/": "server/static/", "index.html": "index.html", "session_id localStorage": "session_id 本地存储", "POST /api/research": "POST /api/research", "GET /stream (SSE)": "GET /stream（SSE）", "GET /health + /docs": "GET /health + /docs",
    "ResearchRequest / Response": "ResearchRequest / Response", "Pydantic validation + metadata": "Pydantic 校验 + 元信息", "agent.py": "agent.py", "run_research_agent()": "run_research_agent()", "shared client + logger": "共享 client + logger", "partial failure still reports": "部分失败仍尝试产出报告",
    "researcher.py": "researcher.py", "System Prompt + tools": "系统提示词 + 工具", "while tool_calls": "while tool_calls 循环", "max_steps + trace": "max_steps + 执行追踪", "extract findings": "提取 findings",
    "reporter.py": "reporter.py", "findings → JSON report": "findings → JSON 报告", "no tools": "不提供工具", "response schema validation": "响应 Schema 校验",
    "zhipuai client": "zhipuai client", "function calling": "函数调用", "usage / temperature": "用量 / 温度", "prompts.py": "prompts.py", "researcher system": "researcher 系统提示词", "reporter JSON template": "reporter JSON 模板",
    "search_web()": "search_web()", "DuckDuckGo + retry": "DuckDuckGo + 重试", "fetch_url()": "fetch_url()", "readability extract": "readability 正文提取", "query_docs()": "query_docs()", "semantic top_k": "语义检索 top_k", "company handbook": "公司手册", "tech wiki": "技术 Wiki",
    "common/tools.py: timeout + retry + unified {success, result}": "common/tools.py：超时 + 重试 + 统一 {success, result}", "common/schemas.py: Tool Schema / Tool Registry / response format": "common/schemas.py：工具 Schema / 工具注册表 / 响应格式",
    "web pages": "网页", "search index": "搜索索引", "external source": "外部来源", "common/state.py": "common/state.py", "messages / steps": "messages / steps", "tool_history / errors": "tool_history / errors",
    "ResearchState:": "ResearchState：", "topic, findings, report": "topic、findings、report", "token accounting": "Token 统计", "server/storage.py": "server/storage.py", "SQLite sessions.db": "SQLite sessions.db",
    "session_id → history": "session_id → 历史记录", "read before / write after": "执行前读取 / 执行后写回", "thread lock": "线程锁", "common/logger.py": "common/logger.py", "run log + JSONL": "运行日志 + JSONL",
    "on_progress callback": "on_progress 回调", "SSE event stream": "SSE 事件流", "tool elapsed / tokens": "工具耗时 / Token", "knowledge/*.txt": "knowledge/*.txt", "RAG index input": "RAG 索引输入",
    "rag/loader.py → chunk(400, overlap=50) → rag/embedder.py (bge-small-zh)": "rag/loader.py → 切块(400, overlap=50) → rag/embedder.py (bge-small-zh)", "rag/store.py": "rag/store.py", "Chroma PersistentClient": "Chroma PersistentClient",
    "embeddings + source metadata": "向量 + 来源元数据", "rag/chain.py": "rag/chain.py", "retrieve → context → GLM": "检索 → 上下文 → GLM", "grounded answer + sources": "有依据的回答 + 来源",
    "workflow/agent.py": "workflow/agent.py", "Planner → Executor": "Planner → Executor", "→ Synthesizer": "→ Synthesizer", "fixed Plan-and-Solve": "固定的 Plan-and-Solve", "Executor reuses Agent × N": "Executor 复用 Agent × N",
    "evaluation/runner.py": "evaluation/runner.py", "test_cases + metrics": "测试用例 + 指标", "judge.py: LLM-as-Judge": "judge.py：LLM 评审", "report.py + JSON artifacts": "report.py + JSON 产物", "offline batch / serial": "离线批处理 / 串行",
    "langchain_version/: @tool + bind_tools + AgentExecutor reference": "langchain_version/：@tool + bind_tools + AgentExecutor 对照", "config.py + .env · API key / model / temperature": "config.py + .env · API key / 模型 / 温度",
    "static/index.html": "static/index.html", "topic + session_id": "topic + session_id", "SSE progress": "SSE 进度", "server/main.py": "server/main.py", "invoke / stream graph": "调用 / 流式执行图", "HTTP response": "HTTP 响应", "SSE bridge": "SSE 桥接",
    "server/schemas.py stays stable for callers": "server/schemas.py 对调用方保持稳定", "topic + history": "topic + 历史消息", "max_tool_rounds": "max_tool_rounds", "runtime config": "运行时配置",
    "TypedDict / MessagesState": "TypedDict / MessagesState", "messages: add_messages": "messages：add_messages", "findings / report": "findings / report", "tool trace / tokens": "工具追踪 / Token", "state updates via reducers": "通过 reducer 更新状态",
    "Node: LLM + bind_tools": "节点：LLM + bind_tools", "decides tool_calls": "决定 tool_calls", "returns AIMessage": "返回 AIMessage", "increments model count": "累加模型调用次数",
    "conditional": "条件", "edge": "边", "tools?": "是否调用工具？", "prebuilt executor": "预置执行器", "runs @tool adapters": "执行 @tool 适配器", "ToolMessage result": "ToolMessage 结果", "returns to model": "返回模型节点",
    "Node: tool trace →": "节点：工具追踪 →", "clean research context": "干净的研究上下文", "preserves partial data": "保留部分数据", "Node": "节点", "JSON": "JSON", "report": "报告",
    "business: max_tool_rounds  |  framework: recursion_limit  |  retry/timeout stays inside reused tools  |  partial result path": "业务：max_tool_rounds ｜ 框架：recursion_limit ｜ 重试/超时保留在复用工具内 ｜ 部分结果兜底",
    "ChatZhipuAI or": "ChatZhipuAI 或", "compatible ChatModel": "兼容的 ChatModel", "Config + .env": "Config + .env", "@tool wrappers": "@tool 包装器", "search / fetch": "搜索 / 抓取", "loader / embedder": "加载 / 向量化",
    "Chroma VectorStore": "Chroma 向量库", "knowledge/*.txt": "knowledge/*.txt", "query_docs tool": "query_docs 工具", "researcher prompt": "researcher 提示词", "report template": "报告模板", "Pydantic/Zod-like": "Pydantic/Zod 类校验", "validation": "校验",
    "research_agent/ remains the baseline for regression, evaluation and migration comparison": "research_agent/ 保留为回归、评估与迁移对照基线", "existing SQLite storage.py": "现有 SQLite storage.py", "session_id → user/assistant": "session_id → 用户/助手消息",
    "history loaded at graph input": "图输入时加载历史", "summary written at graph end": "图结束时写入摘要", "NEW: SQLite/Postgres saver": "新增：SQLite/Postgres saver", "thread_id → state snapshots": "thread_id → 状态快照",
    "pause / resume / replay": "暂停 / 恢复 / 回放", "not equal to chat memory": "不等同于对话记忆", "graph.stream(stream_mode=updates)": "graph.stream(stream_mode=updates)", "node updates → Queue → SSE": "节点更新 → Queue → SSE",
    "logger / token usage / tool trace": "日志 / Token 用量 / 工具追踪", "optional LangSmith later": "后续可选 LangSmith", "topic → subtopics": "topic → 子课题", "structured plan": "结构化计划", "fallback: single topic": "兜底：单课题",
    "dynamic edges": "动态边", "one state /": "每个子课题 /", "subtopic": "一份状态", "START → model": "START → model", "↔ ToolNode": "↔ ToolNode", "→ reporter": "→ reporter", "runs per subtopic": "每个子课题运行一次", "reduce": "归并", "subreports": "子报告", "final JSON": "最终 JSON",
    "HTTP / EventSource": "HTTP / EventSource", "topic + session": "课题 + 会话", "state": "状态", "LLM call": "LLM 调用", "findings": "研究素材", "template": "模板", "LLM output": "LLM 输出", "tool call": "工具调用", "private query": "私有检索", "retry / timeout": "重试 / 超时", "HTTP": "HTTP", "Observation → next LLM decision": "观察结果 → 下一次 LLM 决策",
    "history": "历史", "progress / trace": "进度 / 追踪", "chunks + vectors": "文本块 + 向量", "top_k context": "top_k 上下文", "benchmark": "基准测试", "framework contrast": "框架对照", "initial state": "初始状态", "messages": "消息", "tool_calls?": "是否有 tool_calls？", "yes": "是", "no": "否", "ToolMessage → model": "ToolMessage → model", "limits": "限制", "query_docs": "query_docs", "context": "上下文", "subtopics": "子课题", "Send × N": "Send × N", "subreports": "子报告",
    "FLOW LEGEND": "连线图例", "primary data / request": "主数据 / 请求", "memory read / write": "记忆读取 / 写入", "control / trigger": "控制 / 触发", "LLM-tool feedback loop": "LLM-工具反馈循环", "CURRENT": "当前", "IMPLEMENTED SYSTEM MAP": "已实现系统全景图", "TARGET": "目标", "LANGGRAPH MIGRATION MAP": "LangGraph 迁移架构图",
}


def tr(value: str) -> str:
    return CN.get(value, value)


def svg_base(title: str, subtitle: str) -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
        '<defs>',
        '  <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#112240" stroke-width="0.5"/></pattern>',
        '  <marker id="arrow-cyan" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#00b4d8"/></marker>',
        '  <marker id="arrow-green" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#06d6a0"/></marker>',
        '  <marker id="arrow-orange" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#f77f00"/></marker>',
        '  <marker id="arrow-purple" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polygon points="0 0, 9 3.5, 0 7" fill="#b388ff"/></marker>',
        '</defs>',
        f'<style>text {{ font-family: {FONT}; }} .title {{ fill:#ffffff;font-size:27px;font-weight:700;letter-spacing:.04em }} .subtitle {{ fill:#90e0ef;font-size:14px }} .section {{ fill:#00b4d8;font-size:14px;font-weight:700;letter-spacing:.08em }} .node-title {{ fill:#caf0f8;font-size:15px;font-weight:700 }} .node-body {{ fill:#90e0ef;font-size:11px }} .small {{ fill:#48cae4;font-size:10px }} .edge-label {{ fill:#caf0f8;font-size:10px }} .legend {{ fill:#90e0ef;font-size:10px }} </style>',
        f'<rect width="{W}" height="{H}" fill="#0a1628" data-graph-role="background"/>',
        f'<rect width="{W}" height="{H}" fill="url(#grid)" opacity="0.72" data-graph-role="background"/>',
        f'<text x="60" y="54" class="title">{escape(tr(title))}</text>',
        f'<text x="60" y="80" class="subtitle">{escape(tr(subtitle))}</text>',
        '<line x1="60" y1="98" x2="1740" y2="98" stroke="#00b4d8" stroke-width="1" opacity=".7"/>',
    ]


def container(lines: list[str], x: int, y: int, w: int, h: int, label: str, note: str = "") -> None:
    lines.extend([
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#0d1f3c" fill-opacity=".62" stroke="#00b4d8" stroke-width="1" stroke-dasharray="7,4" data-graph-role="container"/>',
        f'<text x="{x + 18}" y="{y + 26}" class="section">{escape(tr(label))}</text>',
    ])
    if note:
        lines.append(f'<text x="{x + 18}" y="{y + 44}" class="small">{escape(tr(note))}</text>')


def card(lines: list[str], node_id: str, x: int, y: int, w: int, h: int, title: str, body: list[str], color: str = "#0d1f3c", stroke: str = "#00b4d8") -> None:
    lines.append(f'<g id="{node_id}" data-graph-role="node">')
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{color}" stroke="{stroke}" stroke-width="1.4"/>')
    lines.append(f'<text x="{x + 14}" y="{y + 23}" class="node-title">{escape(tr(title))}</text>')
    for idx, line in enumerate(body):
        lines.append(f'<text x="{x + 14}" y="{y + 43 + idx * 15}" class="node-body">{escape(tr(line))}</text>')
    lines.append('</g>')


def arrow(lines: list[str], path: str, flow: str, label: str = "", label_xy: tuple[int, int] | None = None, dash: str = "") -> None:
    colors = {"data": "#00b4d8", "read": "#06d6a0", "write": "#06d6a0", "control": "#f77f00", "loop": "#b388ff"}
    markers = {"data": "arrow-cyan", "read": "arrow-green", "write": "arrow-green", "control": "arrow-orange", "loop": "arrow-purple"}
    color = colors[flow]
    dashed = f' stroke-dasharray="{dash}"' if dash else (" stroke-dasharray=\"5,3\"" if flow == "write" else "")
    lines.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="1.7"{dashed} marker-end="url(#{markers[flow]})" data-graph-role="edge"/>')
    if label and label_xy:
        x, y = label_xy
        lines.append(f'<text x="{x}" y="{y}" class="edge-label">{escape(tr(label))}</text>')


def legend(lines: list[str], x: int, y: int) -> None:
    lines.extend([
        f'<g data-graph-role="legend"><rect x="{x}" y="{y}" width="460" height="74" fill="#0d1f3c" stroke="#00b4d8" stroke-width="1"/>',
        f'<text x="{x + 14}" y="{y + 19}" class="section">连线图例</text>',
        f'<line x1="{x + 14}" y1="{y + 39}" x2="{x + 48}" y2="{y + 39}" stroke="#00b4d8" stroke-width="2" marker-end="url(#arrow-cyan)"/><text x="{x + 57}" y="{y + 43}" class="legend">主数据 / 请求</text>',
        f'<line x1="{x + 192}" y1="{y + 39}" x2="{x + 226}" y2="{y + 39}" stroke="#06d6a0" stroke-width="2" marker-end="url(#arrow-green)"/><text x="{x + 235}" y="{y + 43}" class="legend">记忆读取 / 写入</text>',
        f'<line x1="{x + 14}" y1="{y + 61}" x2="{x + 48}" y2="{y + 61}" stroke="#f77f00" stroke-width="1.5" stroke-dasharray="3,2" marker-end="url(#arrow-orange)"/><text x="{x + 57}" y="{y + 65}" class="legend">控制 / 触发</text>',
        f'<line x1="{x + 192}" y1="{y + 61}" x2="{x + 226}" y2="{y + 61}" stroke="#b388ff" stroke-width="2" marker-end="url(#arrow-purple)"/><text x="{x + 235}" y="{y + 65}" class="legend">LLM-工具反馈循环</text></g>',
    ])


def footer(lines: list[str], name: str, detail: str) -> None:
    lines.extend([
        '<rect x="1380" y="1194" width="360" height="56" fill="#0d1f3c" stroke="#00b4d8" stroke-width="1" data-graph-role="decoration"/>',
        '<line x1="1380" y1="1214" x2="1740" y2="1214" stroke="#00b4d8" stroke-width=".7"/>',
        f'<text x="1560" y="1210" text-anchor="middle" class="small">WEEK-RESEARCH-AGENT / {escape(tr(name))}</text>',
        f'<text x="1560" y="1237" text-anchor="middle" class="node-title">{escape(tr(detail))}</text>',
        '</svg>',
    ])


def current_architecture() -> str:
    lines = svg_base(
        "WEEK-RESEARCH-AGENT · CURRENT IMPLEMENTED ARCHITECTURE",
        "手写 Function Calling Agent + RAG + Session Memory + Workflow + SSE · 代码模块与主要数据流",
    )
    # Containers
    container(lines, 45, 125, 340, 410, "01 ENTRY & DELIVERY", "server/ · HTTP API / Browser UI / SSE")
    container(lines, 430, 125, 700, 410, "02 SINGLE-TOPIC AGENT RUNTIME", "research_agent/ · two-phase architecture: research → structured report")
    container(lines, 1175, 125, 580, 410, "03 EXTERNAL KNOWLEDGE & TOOLS", "common/tools.py · public web + private knowledge retrieval")
    container(lines, 45, 580, 1040, 370, "04 STATE, MEMORY & RAG FOUNDATION", "messages / tool trace / token usage / persistent session / vector retrieval")
    container(lines, 1130, 580, 625, 370, "05 SCALE, QUALITY & LEARNING ADAPTERS", "large-topic workflow / evaluation / LangChain comparison")

    # entry
    card(lines, "browser", 75, 175, 130, 110, "Browser UI", ["server/static/", "index.html", "session_id localStorage"], "#10345a")
    card(lines, "api", 235, 155, 125, 150, "FastAPI", ["server/main.py", "POST /api/research", "GET /stream (SSE)", "GET /health + /docs"], "#10345a")
    card(lines, "schemas", 75, 350, 285, 115, "HTTP Contract", ["server/schemas.py", "ResearchRequest / Response", "Pydantic validation + metadata"], "#0d1f3c")

    # core
    card(lines, "agent", 460, 180, 170, 140, "Orchestrator", ["agent.py", "run_research_agent()", "shared client + logger", "partial failure still reports"], "#123f49", "#06d6a0")
    card(lines, "researcher", 675, 150, 190, 175, "Researcher Loop", ["researcher.py", "System Prompt + tools", "while tool_calls", "max_steps + trace", "extract findings"], "#123f49", "#06d6a0")
    card(lines, "reporter", 900, 180, 195, 140, "Reporter", ["reporter.py", "findings → JSON report", "no tools", "response schema validation"], "#123f49", "#06d6a0")
    card(lines, "llm", 675, 365, 190, 110, "GLM Adapter", ["zhipuai client", "function calling", "usage / temperature"], "#241849", "#b388ff")
    card(lines, "prompts", 900, 365, 195, 110, "Prompt Contract", ["prompts.py", "researcher system", "reporter JSON template"], "#241849", "#b388ff")

    # tools
    card(lines, "web", 1205, 165, 160, 135, "Web Tools", ["search_web()", "DuckDuckGo + retry", "fetch_url()", "readability extract"], "#3b260d", "#f77f00")
    card(lines, "ragtool", 1400, 165, 160, 135, "Private RAG Tool", ["query_docs()", "semantic top_k", "company handbook", "tech wiki"], "#123f49", "#06d6a0")
    card(lines, "toolguard", 1205, 355, 355, 110, "Tool Reliability & Schemas", ["common/tools.py: timeout + retry + unified {success, result}", "common/schemas.py: Tool Schema / Tool Registry / response format"], "#0d1f3c")
    card(lines, "internet", 1590, 355, 130, 110, "Internet", ["web pages", "search index", "external source"], "#0d1f3c")

    # foundation
    card(lines, "state", 75, 640, 210, 150, "Agent State", ["common/state.py", "messages / steps", "tool_history / errors", "ResearchState:", "topic, findings, report", "token accounting"], "#1a273d")
    card(lines, "memory", 330, 640, 205, 150, "Session Memory", ["server/storage.py", "SQLite sessions.db", "session_id → history", "read before / write after", "thread lock"], "#1a273d")
    card(lines, "logger", 580, 640, 190, 150, "Observability", ["common/logger.py", "run log + JSONL", "on_progress callback", "SSE event stream", "tool elapsed / tokens"], "#1a273d")
    card(lines, "kbsource", 815, 640, 220, 150, "Knowledge Source", ["knowledge/*.txt", "company handbook", "technical wiki", "RAG index input"], "#1a273d")
    card(lines, "ragpipe", 75, 830, 310, 85, "RAG Pipeline", ["rag/loader.py → chunk(400, overlap=50) → rag/embedder.py (bge-small-zh)"], "#1c2e43")
    card(lines, "vector", 430, 820, 250, 105, "Vector Store", ["rag/store.py", "Chroma PersistentClient", "embeddings + source metadata"], "#1a273d")
    card(lines, "ragchain", 725, 820, 310, 105, "Standalone RAG Q&A", ["rag/chain.py", "retrieve → context → GLM", "grounded answer + sources"], "#1c2e43")

    # scale + quality
    card(lines, "workflow", 1160, 635, 260, 170, "Large-topic Workflow", ["workflow/agent.py", "Planner → Executor", "→ Synthesizer", "fixed Plan-and-Solve", "Executor reuses Agent × N"], "#123f49", "#06d6a0")
    card(lines, "eval", 1470, 635, 250, 170, "Evaluation", ["evaluation/runner.py", "test_cases + metrics", "judge.py: LLM-as-Judge", "report.py + JSON artifacts", "offline batch / serial"], "#3b260d", "#f77f00")
    card(lines, "langchain", 1160, 845, 260, 75, "LangChain Comparison", ["langchain_version/: @tool + bind_tools + AgentExecutor reference"], "#241849", "#b388ff")
    card(lines, "config", 1470, 845, 250, 75, "Shared Configuration", ["config.py + .env · API key / model / temperature"], "#0d1f3c")

    # arrows, primary execution path
    arrow(lines, "M 205 230 H 235", "data", "HTTP / EventSource", (190, 218))
    arrow(lines, "M 360 230 H 430 V 250 H 460", "data", "topic + session", (375, 218))
    arrow(lines, "M 630 250 H 675", "data", "state", (638, 240))
    arrow(lines, "M 770 325 V 365", "data", "LLM call", (780, 353))
    arrow(lines, "M 865 250 H 900", "data", "findings", (862, 238))
    arrow(lines, "M 998 320 V 365", "control", "template", (1008, 351), "3,2")
    arrow(lines, "M 865 420 H 900 V 325", "data", "LLM output", (870, 353))
    arrow(lines, "M 675 225 H 650 V 115 H 1275 V 165", "control", "tool call", (1000, 135), "3,2")
    arrow(lines, "M 1365 230 H 1400", "data", "private query", (1360, 218))
    arrow(lines, "M 1285 300 V 355", "control", "retry / timeout", (1294, 340), "3,2")
    arrow(lines, "M 1560 410 H 1590", "data", "HTTP", (1560, 400))
    arrow(lines, "M 1480 465 V 490 H 650 V 325 H 675", "loop", "Observation → next LLM decision", (1080, 480))
    # state/memory/observability edges
    arrow(lines, "M 285 710 H 330", "read", "history", (290, 700))
    arrow(lines, "M 630 320 V 560 H 675 V 640", "control", "progress / trace", (680, 550), "3,2")
    # RAG edges
    arrow(lines, "M 385 872 H 430", "data", "chunks + vectors", (387, 862))
    arrow(lines, "M 680 872 H 725", "read", "top_k context", (682, 862))
    arrow(lines, "M 1420 720 H 1470", "control", "benchmark", (1425, 710), "3,2")
    arrow(lines, "M 1290 805 V 845", "control", "framework contrast", (1300, 835), "3,2")
    legend(lines, 60, 1110)
    footer(lines, "CURRENT", "IMPLEMENTED SYSTEM MAP")
    return "\n".join(lines)


def langgraph_target_architecture() -> str:
    lines = svg_base(
        "WEEK-RESEARCH-AGENT · LANGGRAPH TARGET ARCHITECTURE",
        "迁移设计图（尚未落地）· 复用现有工具、RAG、Memory 与 HTTP 层，用 StateGraph 显式编排状态、循环与路由",
    )
    container(lines, 45, 125, 340, 330, "01 UNCHANGED DELIVERY LAYER", "existing server/ remains the entry point")
    container(lines, 430, 125, 870, 560, "02 LANGGRAPH SINGLE-TOPIC RESEARCH GRAPH", "langgraph_version/ · StateGraph nodes + conditional edges + ToolNode")
    container(lines, 1345, 125, 410, 560, "03 REUSED CAPABILITIES", "existing modules are adapters, not rewrites")
    container(lines, 45, 730, 890, 250, "04 STATE PERSISTENCE & OBSERVABILITY", "separate conversation memory from graph execution checkpoints")
    container(lines, 980, 730, 775, 250, "05 LANGGRAPH LARGE-TOPIC WORKFLOW GRAPH", "Planner fan-out via Send → subgraph research × N → Synthesizer")

    card(lines, "ui2", 75, 180, 125, 105, "Browser UI", ["static/index.html", "topic + session_id", "SSE progress"], "#10345a")
    card(lines, "api2", 235, 165, 125, 135, "FastAPI Adapter", ["server/main.py", "invoke / stream graph", "HTTP response", "SSE bridge"], "#10345a")
    card(lines, "contract2", 75, 335, 285, 75, "API Contract", ["server/schemas.py stays stable for callers"], "#0d1f3c")

    card(lines, "input", 465, 205, 175, 105, "Graph Input", ["topic + history", "max_tool_rounds", "runtime config"], "#10345a")
    card(lines, "stategraph", 685, 165, 205, 145, "Graph State", ["TypedDict / MessagesState", "messages: add_messages", "findings / report", "tool trace / tokens", "state updates via reducers"], "#1a273d")
    card(lines, "modelnode", 940, 165, 190, 145, "researcher_model", ["Node: LLM + bind_tools", "decides tool_calls", "returns AIMessage", "increments model count"], "#123f49", "#06d6a0")
    card(lines, "router", 1170, 190, 100, 95, "Router", ["conditional", "edge", "tools?"], "#3b260d", "#f77f00")
    card(lines, "toolnode", 695, 390, 195, 145, "ToolNode", ["prebuilt executor", "runs @tool adapters", "ToolMessage result", "returns to model"], "#123f49", "#06d6a0")
    card(lines, "findingsnode", 940, 390, 190, 145, "collect_findings", ["Node: tool trace →", "clean research context", "preserves partial data"], "#123f49", "#06d6a0")
    card(lines, "reportnode", 1170, 390, 100, 145, "reporter", ["Node", "JSON", "report"], "#123f49", "#06d6a0")
    card(lines, "guard", 465, 570, 805, 70, "Safety & Runtime Guardrails", ["business: max_tool_rounds  |  framework: recursion_limit  |  retry/timeout stays inside reused tools  |  partial result path"], "#241849", "#b388ff")

    card(lines, "llmadapt", 1380, 165, 160, 110, "LLM Adapter", ["ChatZhipuAI or", "compatible ChatModel", "Config + .env"], "#241849", "#b388ff")
    card(lines, "tooladapt", 1575, 165, 150, 110, "Tool Adapters", ["@tool wrappers", "search / fetch", "query_docs"], "#3b260d", "#f77f00")
    card(lines, "ragreuse", 1380, 330, 160, 135, "RAG Reuse", ["loader / embedder", "Chroma VectorStore", "knowledge/*.txt", "query_docs tool"], "#1a273d")
    card(lines, "promptreuse", 1575, 330, 150, 135, "Prompts & Schema", ["researcher prompt", "report template", "Pydantic/Zod-like", "validation"], "#1a273d")
    card(lines, "corelegacy", 1380, 510, 345, 90, "Existing Manual Agent Is Retained", ["research_agent/ remains the baseline for regression, evaluation and migration comparison"], "#0d1f3c")

    card(lines, "session", 75, 790, 220, 130, "Conversation Memory", ["existing SQLite storage.py", "session_id → user/assistant", "history loaded at graph input", "summary written at graph end"], "#1a273d")
    card(lines, "checkpointer", 350, 790, 220, 130, "Graph Checkpointer", ["NEW: SQLite/Postgres saver", "thread_id → state snapshots", "pause / resume / replay", "not equal to chat memory"], "#1a273d")
    card(lines, "trace", 625, 790, 260, 130, "Streaming & Trace", ["graph.stream(stream_mode=updates)", "node updates → Queue → SSE", "logger / token usage / tool trace", "optional LangSmith later"], "#1a273d")

    card(lines, "planner", 1015, 790, 175, 130, "planner Node", ["topic → subtopics", "structured plan", "fallback: single topic"], "#123f49", "#06d6a0")
    card(lines, "send", 1235, 815, 130, 80, "Send Fan-out", ["dynamic edges", "one state /", "subtopic"], "#3b260d", "#f77f00")
    card(lines, "subgraph", 1410, 775, 155, 160, "Research Subgraph", ["START → model", "↔ ToolNode", "→ reporter", "runs per subtopic"], "#123f49", "#06d6a0")
    card(lines, "synth", 1610, 790, 110, 130, "synthesizer", ["reduce", "subreports", "final JSON"], "#123f49", "#06d6a0")

    # current-to-target execution
    arrow(lines, "M 200 232 H 235", "data", "HTTP / SSE", (193, 220))
    arrow(lines, "M 360 232 H 430 V 257 H 465", "data", "topic + session_id", (372, 220))
    arrow(lines, "M 640 257 H 685", "data", "initial state", (645, 245))
    arrow(lines, "M 890 237 H 940", "data", "messages", (890, 225))
    arrow(lines, "M 1130 237 H 1170", "control", "tool_calls?", (1128, 225), "3,2")
    arrow(lines, "M 1170 237 V 360 H 792 V 390", "control", "yes", (1000, 350), "3,2")
    arrow(lines, "M 695 462 H 650 V 335 H 940 V 310", "loop", "ToolMessage → model", (760, 325))
    arrow(lines, "M 1270 237 V 370 H 1035 V 390", "control", "no", (1120, 360), "3,2")
    arrow(lines, "M 1130 462 H 1170", "data", "findings", (1120, 450))
    arrow(lines, "M 465 310 V 570", "control", "limits", (475, 440), "3,2")
    # reuses
    arrow(lines, "M 1540 397 H 1575", "read", "context", (1534, 386))
    arrow(lines, "M 1650 275 V 300 H 1460 V 330", "read", "query_docs", (1475, 290))
    # persistence
    arrow(lines, "M 295 855 H 350", "write", "checkpoint state", (297, 845))
    # workflow
    arrow(lines, "M 1190 855 H 1235", "data", "subtopics", (1192, 845))
    arrow(lines, "M 1365 855 H 1410", "control", "Send × N", (1368, 845), "3,2")
    arrow(lines, "M 1565 855 H 1610", "data", "subreports", (1566, 845))

    legend(lines, 60, 1080)
    footer(lines, "TARGET", "LANGGRAPH MIGRATION MAP")
    return "\n".join(lines)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "research-agent-current-architecture.svg").write_text(current_architecture(), encoding="utf-8")
    (OUT / "research-agent-langgraph-target-architecture.svg").write_text(langgraph_target_architecture(), encoding="utf-8")
    print("Generated architecture SVGs in", OUT)


if __name__ == "__main__":
    main()
