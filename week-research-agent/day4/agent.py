"""
Day 4 - 健壮性升级：日志 + 结构化输出 + 重试/超时。

【Day 3 → Day 4 的三项升级】
1. 日志系统：每次运行写日志文件（可审计）+ JSONL 汇总（可统计）
2. 结构化输出：让 LLM 返回 JSON，下游程序能用
3. 重试/超时：search_web 加 @retry_with_timeout 保护

【设计原则】
state.py 复用 Day 3 的（import 过来），不重复造轮子。
体现"代码资产积累"——Day 3 的 State 是 Day 4 的基础。
"""
import json
import sys
import os
import time
from dataclasses import dataclass
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config

# Day 5 重构：公共代码提到 common/，不再用 importlib 加载 day3/state.py
from common.logger import setup_logger, save_run_summary
from common.tools import add, read_file, list_dir, search_web
from common.schemas import TOOLS_SCHEMA, RESPONSE_FORMAT
from common.state import AgentState as _Day3AgentState, ToolCallRecord


# ============================================================
# Day 4 专属 State：继承 common 的 AgentState，新增结构化输出字段
# ============================================================
# 为什么用继承？
# - @dataclass 继承会自动把 structured_answer 加入 __init__/__repr__/__eq__
#   避免"运行时给对象加属性"导致字段在序列化/打印/比较时漏掉
# 注意：dataclass 继承时，父类带默认值的字段，子类新字段也必须给默认值，
#       否则参数顺序冲突（Python dataclass 的已知约束）。
@dataclass
class AgentState(_Day3AgentState):
    """Day 4 Agent 状态：Day 3 状态 + 结构化输出。"""
    structured_answer: Any = None  # 结构化输出模式下的解析结果（dict 或 None）


TOOL_REGISTRY = {
    "add": add,
    "read_file": read_file,
    "list_dir": list_dir,
    "search_web": search_web,
}


def run_agent(user_input: str, max_steps: int = 8, structured: bool = False) -> AgentState:
    """
    运行 Agent（Day 4 健壮性版）。

    参数：
        user_input: 用户问题
        max_steps:  最大步数
        structured: True = 返回 JSON 结构化输出；False = 自然语言
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    # Day 4 新增：创建 logger，全程记录
    logger = setup_logger("agent")
    logger.info("=" * 50)
    logger.info(f"📝 用户问：{user_input}")
    logger.info(f"结构化输出：{structured}")

    state = AgentState(max_steps=max_steps)
    # Day 4：如果结构化输出，在 user message 里加明确的格式指令
    # （单独靠 response_format 不可靠，必须配合 prompt 明确要求）
    if structured:
        actual_input = (
            f"{user_input}\n\n"
            "请严格按以下 JSON 格式回答（不要输出任何其他内容）：\n"
            "{\n"
            '  "summary": "对问题的简要总结回答",\n'
            '  "key_points": ["要点1", "要点2", ...],\n'
            '  "sources": ["来源链接1", ...],\n'
            '  "confidence": "high 或 medium 或 low"\n'
            "}"
        )
    else:
        actual_input = user_input
    state.messages = [{"role": "user", "content": actual_input}]

    try:
        # 第 1 轮
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=state.messages,
            tools=TOOLS_SCHEMA,
            temperature=Config.TEMPERATURE,
        )
        message = response.choices[0].message

        # while 循环（和 Day 3 一样，但每步加日志）
        while message.tool_calls:
            if not state.can_continue():
                state.status = "max_steps_reached"
                logger.warning(f"⚠️ 达到最大步数 {state.max_steps}，强制停止")
                break

            state.steps += 1
            logger.info(f"--- 第 {state.steps} 步 ---")
            state.messages.append(message.model_dump())

            for tool_call in message.tool_calls:
                fn_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                logger.info(f"🔧 调用工具：{fn_name}({args})")

                start_time = time.time()
                if fn_name not in TOOL_REGISTRY:
                    result = {"success": False, "result": f"未知工具：{fn_name}"}
                else:
                    # Day 4：工具自带重试/超时保护（@retry_with_timeout 装饰）
                    result = TOOL_REGISTRY[fn_name](**args)
                elapsed = time.time() - start_time

                state.add_tool_call(ToolCallRecord(
                    step=state.steps,
                    tool_name=fn_name,
                    arguments=args,
                    result=result,
                    elapsed=elapsed,
                    success=result.get("success", False),
                ))

                ok_mark = "✓" if result.get("success") else "✗"
                preview = str(result.get("result") or result.get("results") or result)
                if len(preview) > 100:
                    preview = preview[:100] + "..."
                logger.info(f"   {ok_mark} 结果（{elapsed:.2f}s）：{preview}")

                state.messages.append({
                    "role": "tool",
                    "content": json.dumps(result, ensure_ascii=False),
                    "tool_call_id": tool_call.id,
                })

            # 最后一轮：如果要结构化输出，加 response_format
            response = client.chat.completions.create(
                model=Config.MODEL,
                messages=state.messages,
                tools=TOOLS_SCHEMA,
                temperature=Config.TEMPERATURE,
                **({"response_format": RESPONSE_FORMAT} if structured else {}),
            )
            message = response.choices[0].message

        # 循环结束
        if state.status == "running":
            state.status = "finished"
        state.final_answer = message.content or ""

        # Day 4：如果结构化输出，把答案解析成 dict 挂到 state 上
        if structured:
            try:
                parsed = json.loads(state.final_answer)
                # 必须是 dict（object），不能是 list 或其他
                if isinstance(parsed, dict):
                    state.structured_answer = parsed
                    logger.info(f"📊 结构化输出解析成功")
                else:
                    logger.error(f"结构化输出格式不对：期望 object，得到 {type(parsed).__name__}")
                    state.structured_answer = None
            except json.JSONDecodeError as e:
                logger.error(f"结构化输出解析失败：{e}")
                state.structured_answer = None

    except Exception as e:
        state.status = "error"
        state.error = f"{type(e).__name__}: {e}"
        logger.error(f"❌ Agent 出错：{state.error}")

    # Day 4 新增：保存运行摘要到 JSONL
    save_run_summary(state, user_input, logger)
    logger.info(f"📋 运行摘要：状态={state.status} 步数={state.steps} 工具={len(state.tool_history)}")

    return state


def main():
    print("=" * 60)
    print(" Day 4 - 健壮性升级（日志 + 结构化输出 + 重试）")
    print(" 命令：")
    print("   普通模式：直接输入问题")
    print("   结构化：  以 'json ' 开头（如 'json 搜一下 OpenAI 最新动态'）")
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
            break

        # 以 "json " 开头则启用结构化输出
        structured = user_input.lower().startswith("json ")
        if structured:
            user_input = user_input[5:]

        # 跑 Agent，拿到 state，然后打印答案（之前漏了这步！）
        state = run_agent(user_input, max_steps=8, structured=structured)

        # 打印最终答案
        print(f"\n{'='*60}")
        if state.status == "error":
            print(f"❌ Agent 出错：{state.error}")
        elif structured and hasattr(state, "structured_answer") and state.structured_answer:
            # 结构化模式：漂亮地打印 JSON
            import json as _json
            print(f"📊 结构化答案：")
            print(_json.dumps(state.structured_answer, indent=2, ensure_ascii=False))
        elif state.final_answer:
            print(f"🤖 Agent 答案：\n{state.final_answer}")
        else:
            print(f"⚠️ Agent 没有给出答案（状态：{state.status}）")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
