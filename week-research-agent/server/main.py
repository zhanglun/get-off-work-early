"""
Day 7 - FastAPI 应用：把 Research Agent 部署成 HTTP 服务。

【核心思路】
Day 5 的 run_research_agent(topic) 已经是个干净函数。
Day 7 不改它，只在外面套一层 HTTP 接口——业务逻辑复用，只加传输层。
这是"关注点分离"：Agent 管研究，HTTP 管传输。

【3 个接口】
- GET  /              返回网页（Web UI）
- GET  /api/health    健康检查（部署用）
- POST /api/research  提交课题，返回研究报告（核心接口）
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from server.schemas import ResearchRequest, ResearchResponse, ResearchMetadata, HealthResponse

# 初始化 FastAPI 应用
app = FastAPI(
    title="Research Agent API",
    description="一个能联网搜索、多步推理、生成研究报告的 AI Agent",
    version="1.0.0",
)

# ===== Day 8 Session Memory：会话存储 =====
# 结构：{session_id: [{"role": "user/assistant", "content": "..."}, ...]}
# 注意：内存存储，服务重启即丢失。生产环境用 Redis 持久化。
SESSIONS: dict = {}

# 会话上限：防止内存无限增长（超过则清理最早的）
MAX_SESSIONS = 100


def get_or_create_session(session_id: str = None) -> str:
    """获取或创建会话，返回 session_id。"""
    import uuid
    if not session_id:
        session_id = str(uuid.uuid4())[:8]

    if session_id not in SESSIONS:
        # 清理：会话数超上限时，删最早的（简单的 LRU 策略）
        if len(SESSIONS) >= MAX_SESSIONS:
            oldest = next(iter(SESSIONS))
            del SESSIONS[oldest]
        SESSIONS[session_id] = []
        print(f"🆕 创建会话 {session_id}")

    return session_id

# 挂载静态文件目录（网页、图片等放在 static/ 下）
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    """返回 Web UI 首页。"""
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return f.read()


@app.get("/api/health", response_model=HealthResponse)
async def health():
    """健康检查接口（部署时用，确认服务活着）。"""
    return HealthResponse(status="ok", service="research-agent")


@app.post("/api/research", response_model=ResearchResponse)
async def research(req: ResearchRequest):
    """
    核心接口：提交研究课题，返回结构化研究报告。

    【同步阻塞说明】
    研究过程要调多次 LLM + 搜索，通常耗时 20-60 秒。
    这里用同步阻塞（FastAPI 会放到线程池跑），简单直接。
    生产环境如果担心超时，应该改成异步任务队列（如 Celery）：
    POST 立即返回 task_id，客户端轮询 GET /api/research/{task_id}。
    但 7 天项目用阻塞式够用，避免引入复杂度。

    【Day 8 Session Memory】
    如果带了 session_id，从会话存储取出历史对话，传给 Agent。
    Agent 就能理解"它""上次"等指代。研究完后把新对话追加进会话存储。
    """
    # 延迟 import 避免循环依赖，也加快启动
    from research_agent.agent import run_research_agent

    try:
        start = time.time()

        # ===== Day 8 Session Memory：取出历史对话 =====
        # 用 get_or_create_session 确保 session 存在（即使客户端传了新的 id）
        session_id = get_or_create_session(req.session_id)
        history = SESSIONS.get(session_id, [])
        if history:
            print(f"📚 会话 {session_id}：加载 {len(history)} 条历史")

        # 复用 Day 5 的核心函数（Day 8 加了 history 参数）
        state = run_research_agent(req.topic, max_steps=8, verbose=False, history=history)
        elapsed = time.time() - start

        # ===== Day 8 Session Memory：把本次对话存回会话 =====
        if session_id:
            # 把本轮的"用户问 + Agent 答"追加到会话历史
            # 注意：只存 user + assistant 的核心对话，不存 tool 中间消息（太长）
            SESSIONS[session_id].append(
                {"role": "user", "content": req.topic}
            )
            # Agent 的回答用报告的 summary（精炼，不存完整报告省 token）
            answer = state.report.get("summary", "（无摘要）") if state.report else "（研究失败）"
            SESSIONS[session_id].append(
                {"role": "assistant", "content": answer}
            )
            print(f"💾 会话 {session_id}：已存回，共 {len(SESSIONS[session_id])} 条")

        # 打包工具调用明细（给前端展示 Agent 干了什么）
        tool_calls_meta = [
            {
                "step": tc.step,
                "tool": tc.tool_name,
                "args": tc.arguments,
                "success": tc.success,
                "elapsed": round(tc.elapsed, 1),
            }
            for tc in state.tool_history
        ]

        return ResearchResponse(
            topic=req.topic,
            report=state.report,
            metadata=ResearchMetadata(
                steps=state.steps,
                elapsed=round(elapsed, 1),
                status=state.status,
                tool_calls=tool_calls_meta,
            ),
            session_id=session_id,
        )

    except Exception as e:
        # 服务端出错返回 500，让客户端知道失败了
        raise HTTPException(
            status_code=500,
            detail=f"研究过程出错：{type(e).__name__}: {e}",
        )


# ============================================================
# 入口：python -m server 或 python server/main.py
# ============================================================
if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print(" 🔬 Research Agent 服务启动中...")
    print("    访问 http://localhost:8000 使用网页界面")
    print("    访问 http://localhost:8000/docs 查看 API 文档")
    print("    按 Ctrl+C 停止")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
