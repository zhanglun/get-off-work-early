"""
Day 2 - Tool Calling 全链路 + 多工具（while 循环版）。

【和 Day 1 的本质区别】
Day 1 只能处理「LLM 调一次工具」。
Day 2 改成 while 循环，能处理「LLM 连续调多次工具」。

【为什么需要 while 循环】
比如用户问："先算 3+5，再读 README，然后搜一下 AI 进展"
LLM 会先调 add → 拿到结果 → 再调 read_file → 再调 mock_search → 最后综合回答。
单个 if 处理不了这种"多步连续调用"，必须用 while。

【完整流程】
    User 输入
        ↓
    LLM（带 tools）
        ↓
    ┌─→ while message.tool_calls:        ← Day 2 的核心改动
    │       执行所有工具
    │       结果回传给 LLM
    │       拿新的 message
    └──┘
    循环退出（LLM 不再要工具）→ 输出最终答案

【防死循环】Lesson 03 会专门讲 max_steps，今天先用一个简单的步数计数 + 上限保护。
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from tools import add, read_file, mock_search
from schemas import TOOLS_SCHEMA

# Tool Registry：工具名 → 真正的 Python 函数
TOOL_REGISTRY = {
    "add": add,
    "read_file": read_file,
    "mock_search": mock_search,
}


def run_agent(user_input: str, max_steps: int = 8) -> str:
    """
    运行 Agent（支持连续多次工具调用）。

    参数：
        user_input: 用户问题
        max_steps: 最大循环步数，防止 Agent 无限调工具
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    messages = [{"role": "user", "content": user_input}]

    print(f"\n{'='*60}")
    print(f"📝 用户问：{user_input}")
    print(f"{'='*60}")

    # 先发第一轮，让 LLM 决定要不要调工具
    response = client.chat.completions.create(
        model=Config.MODEL,
        messages=messages,
        tools=TOOLS_SCHEMA,
        temperature=Config.TEMPERATURE,
    )
    message = response.choices[0].message

    # ============================================================
    # 核心：while 循环处理连续多次工具调用
    # ============================================================
    # Day 1 这里是 if，Day 2 改成 while——一字之差，能力天壤之别。
    # 循环退出条件：LLM 返回的 message 里不再有 tool_calls
    steps = 0
    while message.tool_calls:
        steps += 1
        if steps > max_steps:
            print(f"\n⚠️ 超过最大步数 {max_steps}，强制停止（防死循环）")
            break

        print(f"\n--- 第 {steps} 步 ---")

        # 关键：触发 tool_call 的 assistant 消息必须 model_dump() 成 dict 放回
        messages.append(message.model_dump())

        # 执行本轮所有工具调用（LLM 一次可能返回多个 tool_call）
        for tool_call in message.tool_calls:
            fn_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)  # 字符串 → dict

            print(f"🔧 调用工具：{fn_name}({args})")

            # 从 Registry 找函数并执行
            if fn_name not in TOOL_REGISTRY:
                result = {"success": False, "result": f"未知工具：{fn_name}"}
            else:
                result = TOOL_REGISTRY[fn_name](**args)

            # 打印结果摘要（太长就截断）
            result_preview = str(result["result"])
            if len(result_preview) > 100:
                result_preview = result_preview[:100] + "..."
            print(f"   → 结果：{result_preview}")

            # 回传结果给 LLM（Observation）
            messages.append({
                "role": "tool",
                "content": json.dumps(result, ensure_ascii=False),
                "tool_call_id": tool_call.id,
            })

        # 再次请求 LLM：根据工具结果，决定还要不要再调工具
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=messages,
            tools=TOOLS_SCHEMA,
            temperature=Config.TEMPERATURE,
        )
        message = response.choices[0].message

    # 循环结束 = LLM 不再需要工具 = 这就是最终答案
    print(f"\n✅ Agent 完成，共调用工具 {steps} 次")
    return message.content


def main():
    print("=" * 60)
    print(" Day 2 - 多工具 Agent（支持连续多次工具调用）")
    print(" 试试这些组合任务：")
    print("   • 先算 12+8，再读 ../README.md，最后搜一下'AI Agent'")
    print("   • 搜一下'今天天气'，然后算 100+200")
    print("   • 帮我读 ../config.py 并告诉我用了什么模型")
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

        try:
            answer = run_agent(user_input)
            print(f"\n🤖 Agent 答案：\n{answer}")
        except Exception as e:
            print(f"\n❌ 出错了：{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
