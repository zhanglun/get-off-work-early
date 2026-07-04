"""
Day 3 - State 管理 + 真实联网搜索 + max_steps 防死循环。

【Day 2 → Day 3 的三个升级】
1. 状态升级：用 AgentState 类管理所有状态，可追溯每一步
2. 安全升级：max_steps 防死循环 + 完整错误处理
3. 能力升级：mock_search → 真实 DuckDuckGo 搜索（Agent 真的能联网了）

【为什么这些升级重要】
Day 2 的 Agent 能跑，但像"裸奔"：
- 没法查"它刚才到底调了几次工具、每次结果是什么"
- 万一 LLM 陷入死循环（一直调工具），没有保护
- 出错时只有一句报错，无法定位

Day 3 把这些工业级能力补齐，这是从"玩具"到"可用 Agent"的关键一步。
"""
import json
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from tools import add, read_file, search_web
from schemas import TOOLS_SCHEMA
from state import AgentState, ToolCallRecord


TOOL_REGISTRY = {
    "add": add,
    "read_file": read_file,
    "search_web": search_web,
}


def run_agent(user_input: str, max_steps: int = 8, verbose: bool = True) -> AgentState:
    """
    运行 Agent（带状态管理 + 防死循环 + 真实搜索）。

    参数：
        user_input: 用户问题
        max_steps:  最大循环步数（防止 LLM 无限调工具）
        verbose:    是否打印详细过程
    返回：
        AgentState 对象（包含完整对话历史、工具调用记录、最终答案、运行摘要）
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    # 初始化状态对象（Day 3 的核心）
    state = AgentState(max_steps=max_steps)
    state.messages = [{"role": "user", "content": user_input}]

    if verbose:
        print(f"\n{'='*60}")
        print(f"📝 用户问：{user_input}")
        print(f"{'='*60}")

    try:
        # 第 1 轮：发问题 + 工具清单
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=state.messages,
            tools=TOOLS_SCHEMA,
            temperature=Config.TEMPERATURE,
        )
        message = response.choices[0].message

        # while 循环 + max_steps 双重保护
        while message.tool_calls:
            # ⚠️ 关键：先用 state 检查能不能继续（防死循环）
            if not state.can_continue():
                state.status = "max_steps_reached"
                if verbose:
                    print(f"\n⚠️ 达到最大步数 {state.max_steps}，强制停止")
                break

            state.steps += 1
            if verbose:
                print(f"\n--- 第 {state.steps} 步 ---")

            # 把 assistant 消息（含 tool_calls）转成 dict 放回
            state.messages.append(message.model_dump())

            # 执行本轮所有工具调用
            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                if verbose:
                    print(f"🔧 调用工具：{fn_name}({args})")

                # 计时 + 执行（用于事后追溯）
                start_time = time.time()
                if fn_name not in TOOL_REGISTRY:
                    result = {"success": False, "result": f"未知工具：{fn_name}"}
                else:
                    result = TOOL_REGISTRY[fn_name](**args)
                elapsed = time.time() - start_time

                # 记录到 state（这是 Day 3 新增的可追溯能力）
                state.add_tool_call(ToolCallRecord(
                    step=state.steps,
                    tool_name=fn_name,
                    arguments=args,
                    result=result,
                    elapsed=elapsed,
                    success=result.get("success", False),
                ))

                if verbose:
                    preview = str(result.get("result") or result.get("results") or result)
                    if len(preview) > 120:
                        preview = preview[:120] + "..."
                    print(f"   → 结果（{elapsed:.2f}s）：{preview}")

                # 回传结果给 LLM
                state.messages.append({
                    "role": "tool",
                    "content": json.dumps(result, ensure_ascii=False),
                    "tool_call_id": tool_call.id,
                })

            # 再问 LLM，看还要不要继续调工具
            response = client.chat.completions.create(
                model=Config.MODEL,
                messages=state.messages,
                tools=TOOLS_SCHEMA,
                temperature=Config.TEMPERATURE,
            )
            message = response.choices[0].message

        # 循环正常退出 = LLM 不再要工具 = 最终答案
        if state.status == "running":
            state.status = "finished"
        state.final_answer = message.content or ""

    except Exception as e:
        state.status = "error"
        state.error = f"{type(e).__name__}: {e}"
        if verbose:
            print(f"\n❌ 出错：{state.error}")

    if verbose:
        print(f"\n{state.summary()}")
        if state.final_answer:
            print(f"\n🤖 最终答案：\n{state.final_answer}")

    return state


def main():
    print("=" * 60)
    print(" Day 3 - State 管理 + 真实联网搜索")
    print(" 试试这些（会真实联网）：")
    print("   • 搜一下 2026 年最新的 AI Agent 框架，并总结")
    print("   • 查一下 OpenAI 最近有什么新动态")
    print("   • 先算 100+200，再搜一下'智谱GLM'")
    print(" 输入 quit 退出")
    print("=" * 60)

    while True:
        try:
            user_input = input("\n你 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("再见！")
            break

        run_agent(user_input, max_steps=8)


if __name__ == "__main__":
    main()
