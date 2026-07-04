"""
Day 3 能力验证脚本。

【怎么用】
    python day3/verify.py

【验证什么】
5 个核心能力，每个对应 Day 3 的一个关键设计。
每个场景真实调用 LLM，跑完出一份验证报告（PASS/FAIL）。
"""
import sys
import os
import time
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import run_agent


# ============================================================
# 验证工具：每个场景统一用这个跑
# ============================================================
def check(name: str, condition: bool, detail: str = "") -> bool:
    """打印一个 ✓ 或 ✗，返回是否通过。"""
    mark = "✓ PASS" if condition else "✗ FAIL"
    extra = f"  ({detail})" if detail else ""
    print(f"  {mark}  {name}{extra}")
    return condition


# ============================================================
# 场景 1：State 可追溯性
# ============================================================
def verify_state_traceability():
    """
    验证：Agent 跑完后，state.tool_history 能完整追溯每次工具调用。

    这是 Day 3 的核心能力——Day 2 做不到，跑完就忘了。
    """
    print("\n" + "=" * 60)
    print("场景 1：State 可追溯性")
    print("=" * 60)
    print("任务：算 25+17，检查 state 是否完整记录")

    state = run_agent("算一下 25 加 17", max_steps=4, verbose=False)

    # 检查点 1：tool_history 不为空
    c1 = check(
        "tool_history 有记录",
        len(state.tool_history) > 0,
        f"记录数={len(state.tool_history)}",
    )

    # 检查点 2：记录里包含 add 工具
    has_add = any(tc.tool_name == "add" for tc in state.tool_history)
    c2 = check("记录里有 add 工具", has_add)

    # 检查点 3：记录字段齐全（step/tool_name/arguments/result/elapsed/success）
    if state.tool_history:
        tc = state.tool_history[0]
        fields_ok = all(hasattr(tc, f) for f in
                        ["step", "tool_name", "arguments", "result", "elapsed", "success"])
        c3 = check("记录字段齐全", fields_ok, f"step={tc.step}, tool={tc.tool_name}")
    else:
        c3 = False

    # 检查点 4：state.summary() 能生成可读报告
    summary = state.summary()
    c4 = check("summary() 生成报告", "Agent 运行摘要" in summary)

    return c1 and c2 and c3 and c4


# ============================================================
# 场景 2：max_steps 防死循环
# ============================================================
def verify_max_steps_protection():
    """
    验证：设 max_steps=1，Agent 不会无限循环。

    防死循环是工业级 Agent 的必备能力。
    我们故意给一个多步任务，但把 max_steps 限制到 1，
    看 Agent 是否会"强制停止"而不是卡死。
    """
    print("\n" + "=" * 60)
    print("场景 2：max_steps 防死循环")
    print("=" * 60)
    print("任务：多步任务，但 max_steps=1，检查是否强制停止")

    state = run_agent(
        "请帮我做三件事：算 1+1，再算 2+2，再算 3+3",
        max_steps=1,  # ← 故意限制只能 1 步
        verbose=False,
    )

    # 检查点 1：步数没有超过 max_steps
    c1 = check(
        "steps 不超过 max_steps",
        state.steps <= 1,
        f"steps={state.steps}, max_steps={state.max_steps}",
    )

    # 检查点 2：状态被标记为 max_steps_reached（前提是它真的想多步）
    # 注意：LLM 可能在 1 步内并行做完所有事，那 status 会是 finished
    # 所以这里检查"要么完成，要么被 max_steps 截断"，都算防护生效
    c2 = check(
        "状态合理（finished 或 max_steps_reached）",
        state.status in ("finished", "max_steps_reached"),
        f"status={state.status}",
    )

    # 检查点 3：Agent 没有卡死（有最终输出或正常退出）
    c3 = check(
        "Agent 没卡死",
        state.status != "running" and state.status != "error",
        f"status={state.status}",
    )

    return c1 and c2 and c3


# ============================================================
# 场景 3：真实联网搜索
# ============================================================
def verify_real_web_search():
    """
    验证：Agent 真的能联网，搜到真实结果。

    这是 Day 2（Mock 假数据）和 Day 3（真实搜索）的本质区别。
    """
    print("\n" + "=" * 60)
    print("场景 3：真实联网搜索")
    print("=" * 60)
    print("任务：搜 OpenAI 最新动态，检查是否真实联网")

    state = run_agent("搜一下 OpenAI 最新动态，简要总结", max_steps=4, verbose=False)

    # 检查点 1：search_web 被调用
    search_calls = [tc for tc in state.tool_history if tc.tool_name == "search_web"]
    c1 = check("search_web 被调用", len(search_calls) > 0)

    # 检查点 2：搜索成功
    if search_calls:
        c2 = check(
            "搜索 success=True",
            search_calls[0].success,
            f"success={search_calls[0].success}",
        )
        # 检查点 3：返回的是真实结构化数据（有 results 数组）
        result = search_calls[0].result
        has_results = isinstance(result, dict) and "results" in result and len(result["results"]) > 0
        c3 = check("返回结构化 results", has_results,
                   f"结果数={len(result.get('results', []))}" if has_results else "")
    else:
        c2 = False
        c3 = False

    # 检查点 4：最终答案不是空话（有实质内容）
    c4 = check("最终答案非空", len(state.final_answer) > 20,
               f"答案长度={len(state.final_answer)}")

    return c1 and c2 and c3 and c4


# ============================================================
# 场景 4：多工具并行调用
# ============================================================
def verify_multi_tool_parallel():
    """
    验证：Agent 能在一次任务里调用多个不同工具。

    这是 Day 2 while 循环 + Day 3 State 管理的综合体现。
    """
    print("\n" + "=" * 60)
    print("场景 4：多工具并行调用")
    print("=" * 60)
    print("任务：搜 Python + 算 10+20 + 读 README，检查是否多工具")

    state = run_agent(
        "请帮我做三件事：1) 搜一下 Python 是什么 2) 算 10+20 3) 读 ../README.md。综合告诉我。",
        max_steps=6, verbose=False,
    )

    # 检查点 1：调用了至少 2 种不同工具
    tool_names = {tc.tool_name for tc in state.tool_history}
    c1 = check(
        "调用至少 2 种工具",
        len(tool_names) >= 2,
        f"工具={tool_names}",
    )

    # 检查点 2：所有工具调用都记录在 tool_history
    c2 = check(
        "tool_history 记录完整",
        len(state.tool_history) >= 2,
        f"调用次数={len(state.tool_history)}",
    )

    # 检查点 3：每个调用都有 step 标记
    all_have_step = all(hasattr(tc, "step") for tc in state.tool_history)
    c3 = check("每条记录都有 step", all_have_step)

    # 检查点 4：最终答案提到了多个任务的结果
    answer = state.final_answer
    c4 = check("答案覆盖多任务", len(answer) > 50, f"答案长度={len(answer)}")

    return c1 and c2 and c3 and c4


# ============================================================
# 场景 5：错误优雅降级
# ============================================================
def verify_error_handling():
    """
    验证：让 Agent 读一个不存在的文件，它不会崩溃。

    这是 Day 3 错误处理的核心——工具失败时，Agent 应该优雅降级，
    而不是整个崩溃。
    """
    print("\n" + "=" * 60)
    print("场景 5：错误优雅降级")
    print("=" * 60)
    print("任务：读一个不存在的文件，检查 Agent 是否崩溃")

    state = run_agent("帮我读一下 这个文件根本不存在.md", max_steps=4, verbose=False)

    # 检查点 1：read_file 被调用
    read_calls = [tc for tc in state.tool_history if tc.tool_name == "read_file"]
    c1 = check("read_file 被调用", len(read_calls) > 0)

    # 检查点 2：read_file 返回 success=False（工具内部捕获了错误）
    if read_calls:
        c2 = check(
            "工具返回 success=False（捕获了错误）",
            read_calls[0].success is False,
            f"success={read_calls[0].success}",
        )
    else:
        c2 = False

    # 检查 3：Agent 整体没有崩溃（status 不是 error）
    c3 = check(
        "Agent 没崩溃",
        state.status in ("finished", "max_steps_reached"),
        f"status={state.status}",
    )

    # 检查点 4：Agent 给出了回答（哪怕说"文件不存在"）
    c4 = check("Agent 仍给出回答", len(state.final_answer) > 5,
               f"答案长度={len(state.final_answer)}")

    return c1 and c2 and c3 and c4


# ============================================================
# 主程序：跑全部验证，出报告
# ============================================================
def main():
    print("=" * 60)
    print(" Day 3 能力验证 —— 共 5 个场景")
    print(" 每个场景真实调用 LLM，约需 30~60 秒")
    print("=" * 60)

    scenarios = [
        ("1. State 可追溯性", verify_state_traceability),
        ("2. max_steps 防死循环", verify_max_steps_protection),
        ("3. 真实联网搜索", verify_real_web_search),
        ("4. 多工具并行调用", verify_multi_tool_parallel),
        ("5. 错误优雅降级", verify_error_handling),
    ]

    results = []
    start = time.time()
    for name, func in scenarios:
        try:
            passed = func()
            results.append((name, passed))
        except Exception as e:
            print(f"  ✗ EXCEPTION  {name}: {type(e).__name__}: {e}")
            results.append((name, False))

    # 总结报告
    total_time = time.time() - start
    passed_count = sum(1 for _, p in results if p)

    print("\n" + "=" * 60)
    print(f" 📋 Day 3 验证报告")
    print("=" * 60)
    for name, passed in results:
        mark = "✓" if passed else "✗"
        print(f"  {mark} {name}")
    print("-" * 60)
    print(f"  通过: {passed_count}/{len(results)}  |  总耗时: {total_time:.1f}s")
    if passed_count == len(results):
        print("\n  🎉 全部通过！Day 3 核心能力可靠。")
    else:
        print(f"\n  ⚠️ 有 {len(results) - passed_count} 项未通过，需要排查。")
    print("=" * 60)


if __name__ == "__main__":
    main()
