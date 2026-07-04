"""
Day 1 - 最小 Agent（单步 Agent Loop）。

【核心认知】对应笔记 Lesson 01 里的「角色 4：Agent Loop」+ 整个 Agent 公式：
    Agent = LLM + Tool + Loop

【今天的完整流程】（单步，最简化版）
    User 输入
        ↓
    LLM（带 tools 参数）  ← 这里 LLM 决定要不要调工具
        ↓
    判断：要不要工具？
    ├─ 不要 → 直接返回答案，结束
    └─ 要   → 拿到 tool_calls
              ↓
              Python 从 Registry 找到函数并执行  ← 这里是真正干活的地方
              ↓
              把结果（Observation）回传给 LLM
              ↓
              LLM 生成最终自然语言答案

【今天先做最简单的：只处理一次工具调用】
Day 2 会扩展成 while 循环，处理连续多次工具调用。
"""
import json
import sys
import os

# 把上一级目录加进 import 路径，这样能 import config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from tools import add, read_file      # 真正干活的函数（角色 3）
from schemas import TOOLS_SCHEMA       # 给 LLM 看的说明书（角色 2）

# ============================================================
# Tool Registry（角色 3 的目录）
# ============================================================
# 作用（笔记 Lesson 02 重点）：根据模型返回的工具名，找到真正的 Python 函数。
# key 必须和 schemas.py 里的 name 完全一致！
TOOL_REGISTRY = {
    "add": add,
    "read_file": read_file,
}


def run_agent(user_input: str) -> str:
    """
    运行一次 Agent。

    参数：
        user_input: 用户的自然语言问题
    返回：
        Agent 的最终自然语言答案
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    # ----- 第 1 步：把用户问题发给 LLM，同时告诉它有哪些工具可用 -----
    messages = [
        {"role": "user", "content": user_input},
    ]

    print(f"\n{'='*60}")
    print(f"📝 用户问：{user_input}")
    print(f"{'='*60}")

    response = client.chat.completions.create(
        model=Config.MODEL,
        messages=messages,
        tools=TOOLS_SCHEMA,   # ← 关键：把工具说明书发给 LLM
        temperature=Config.TEMPERATURE,
    )
    message = response.choices[0].message

    # ----- 第 2 步：判断 LLM 想不想调工具 -----
    if not message.tool_calls:
        # 不需要工具，直接就是答案
        print("\n🤖 LLM 没调工具，直接回答：")
        return message.content

    # ----- 第 3 步：LLM 要调工具，Python 来执行 -----
    # 关键：触发 tool_call 的这条 assistant 消息必须原样放回 messages，
    # 否则下一轮 LLM 会因为"上下文对不上"而报错。
    # 更关键：SDK 要求 messages 里都是 dict（不能是 pydantic 对象），
    # 否则第二次 create() 会报 'xxx object has no attribute "get"'。
    # 所以必须用 model_dump() 把 message 转成 dict。
    messages.append(message.model_dump())

    for tool_call in message.tool_calls:
        fn_name = tool_call.function.name            # 工具名（字符串）
        args_str = tool_call.function.arguments      # 参数（JSON 字符串！不是 dict）
        args = json.loads(args_str)                  # 字符串 → dict

        print(f"\n🔧 LLM 要调工具：{fn_name}({args})")

        # 从 Registry 找到真正的 Python 函数
        if fn_name not in TOOL_REGISTRY:
            result = {"success": False, "result": f"未知工具：{fn_name}"}
        else:
            fn = TOOL_REGISTRY[fn_name]
            result = fn(**args)   # 真正执行！**args 把 dict 解包成关键字参数

        print(f"   → 执行结果：{result['result'] if isinstance(result['result'], str) else str(result['result'])[:80]}")

        # ----- 第 4 步：把执行结果（Observation）回传给 LLM -----
        # 关键格式：role="tool"，content 是 JSON 字符串，必须带 tool_call_id
        messages.append({
            "role": "tool",
            "content": json.dumps(result, ensure_ascii=False),
            "tool_call_id": tool_call.id,   # 必须对应上一步的 id
        })

    # ----- 第 5 步：LLM 根据工具结果，生成最终自然语言答案 -----
    final_response = client.chat.completions.create(
        model=Config.MODEL,
        messages=messages,
        tools=TOOLS_SCHEMA,
        temperature=Config.TEMPERATURE,
    )
    return final_response.choices[0].message.content


# ============================================================
# 主程序：交互式问答
# ============================================================
def main():
    print("=" * 60)
    print(" Day 1 - 最小 Agent（单步工具调用）")
    print(" 试试问：")
    print("   • 3 加 5 等于几？")
    print("   • 帮我读一下 ../README.md 文件")
    print("   • 12.5 加 7.8 是多少？")
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
