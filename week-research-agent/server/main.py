"""
Day 7 - FastAPI 应用：把 Research Agent 部署成 HTTP 服务。

【核心思路】
Day 5 的 run_research_agent(topic) 已经是个干净函数。
Day 7 不改它，只在外面套一层 HTTP 接口——业务逻辑复用，只加传输层。
这是"关注点分离"：Agent 管研究，HTTP 管传输。

【4 个接口】
- GET  /                    返回网页（Web UI）
- GET  /api/health          健康检查（部署用）
- POST /api/research        提交课题，返回研究报告（核心接口，同步）
- GET  /api/research/stream 提交课题，SSE 流式返回进度（Day 9 Streaming）
"""
import os
import sys
import time
import json
import queue
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from server.schemas import ResearchRequest, ResearchResponse, ResearchMetadata, HealthResponse

# 初始化 FastAPI 应用
app = FastAPI(
    title="Research Agent API",
    description="一个能联网搜索、多步推理、生成研究报告的 AI Agent",
    version="1.0.0",
)

# ===== Day 8/10 Session Memory：会话存储 =====
# Day 8：内存 dict（重启即丢）
# Day 10：换成 SQLite 持久化（重启不丢）—— storage.py 封装
import server.storage as storage
from server.storage import get_or_create_session  # 接口兼容，签名一致

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

        # ===== Session Memory：取出历史对话（Day 10 改用 SQLite 持久化）=====
        session_id = get_or_create_session(req.session_id)
        history = storage.get_history(session_id)
        if history:
            print(f"📚 会话 {session_id}：加载 {len(history)} 条历史")

        # 复用 Day 5 的核心函数（Day 8 加了 history 参数）
        state = run_research_agent(req.topic, max_steps=8, verbose=False, history=history)
        elapsed = time.time() - start

        # ===== Session Memory：把本次对话存回会话（持久化到 SQLite）=====
        if session_id:
            # 只存 user + assistant 核心对话，不存 tool 中间消息（太长）
            storage.append_message(session_id, "user", req.topic)
            # Agent 的回答用报告的 summary（精炼，省 token）
            answer = state.report.get("summary", "（无摘要）") if state.report else "（研究失败）"
            storage.append_message(session_id, "assistant", answer)
            print(f"💾 会话 {session_id}：已存回 SQLite")

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
                tokens={
                    "prompt": state.prompt_tokens,
                    "completion": state.completion_tokens,
                    "total": state.total_tokens,
                } if state.total_tokens > 0 else None,
            ),
            session_id=session_id,
        )

    except Exception as e:
        # 服务端出错返回 500，让客户端知道失败了
        raise HTTPException(
            status_code=500,
            detail=f"研究过程出错：{type(e).__name__}: {e}",
        )


@app.get("/api/research/stream")
async def research_stream(topic: str = Query(..., min_length=1, max_length=200),
                          session_id: str = Query(None)):
    """
    Day 9 SSE 流式接口：实时推送 Agent 研究进度。

    【SSE 原理】
    服务器持续推送 event 流，浏览器用 EventSource 接收。
    每条消息格式：
        data: {"event": "tool_start", "tool": "search_web", ...}\\n\\n

    【技术难点：同步 Agent + 异步 SSE 的桥接】
    Agent（run_research_agent）是同步阻塞函数，跑 30 秒。
    SSE 是 async generator，要持续 yield。
    解法：用线程跑 Agent + Queue 传事件给 generator。

    【为什么用 GET 不用 POST】
    EventSource 标准只支持 GET。课题放 URL 参数（<200 字够用）。
    """
    from research_agent.agent import run_research_agent

    # 用 Queue 在 Agent 线程和 SSE generator 之间传事件
    event_queue: queue.Queue = queue.Queue()
    # 用 dict 传最终结果（线程不能直接 return 给 generator）
    result_holder: dict = {}

    def on_progress(event: dict):
        """Agent 的回调：把事件塞进 Queue，generator 会取出来推给前端。"""
        event_queue.put(event)

    def run_agent_thread():
        """在子线程跑 Agent（不阻塞 async generator）。"""
        try:
            sid = get_or_create_session(session_id)
            history = storage.get_history(sid)

            state = run_research_agent(
                topic, max_steps=8, verbose=False,
                history=history, on_progress=on_progress,
            )

            # 存回 session（持久化到 SQLite）
            storage.append_message(sid, "user", topic)
            answer = state.report.get("summary", "（无摘要）") if state.report else "（研究失败）"
            storage.append_message(sid, "assistant", answer)

            result_holder["state"] = state
            result_holder["session_id"] = sid
        except Exception as e:
            result_holder["error"] = f"{type(e).__name__}: {e}"
        finally:
            event_queue.put(None)  # 哨兵：告诉 generator 结束了

    def event_generator():
        """
        SSE generator（同步版）：从 Queue 取事件，推给浏览器。

        【为什么用同步 generator 而不是 async】
        FastAPI 的 StreamingResponse 支持同步 generator——它会自动放到线程池跑。
        这样可以直接用阻塞的 queue.get(timeout=)，简单可靠。
        async 版的 run_in_executor + wait_for 在超时取消时有坑（线程泄漏 + 事件丢失）。
        """
        # 启动 Agent 线程
        thread = threading.Thread(target=run_agent_thread, daemon=True)
        thread.start()

        # 持续推送事件
        while True:
            try:
                # 阻塞取，0.5 秒超时（没事件时发心跳，保持连接）
                event = event_queue.get(timeout=0.5)
            except queue.Empty:
                yield ": heartbeat\n\n"
                continue

            if event is None:
                # 哨兵：Agent 线程结束了
                break

            # 推送事件给前端
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        # 推送最终结果（done 或 error）
        if "error" in result_holder:
            err = {"event": "fatal_error", "error": result_holder["error"]}
            yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n"
        else:
            state = result_holder.get("state")
            final = {
                "event": "done",
                "report": state.report if state else {},
                "session_id": result_holder.get("session_id"),
                "status": state.status if state else "unknown",
            }
            yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲（重要！否则流式失效）
        },
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
