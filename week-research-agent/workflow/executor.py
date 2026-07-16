"""
Executor（执行者）：对每个子课题跑一次研究。

【职责】
拿到 Planner 拆出的子课题列表，对每个子课题调用已有的 run_research_agent。
这是 Workflow 最体现"代码资产积累"的地方——Day 5 的 Agent 成了 Executor 的积木。

【为什么单独一个模块】
Executor 只管"执行"，不管"拆解"和"综合"。
关注点分离，每个模块职责单一。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def execute(subtopics: list, verbose: bool = True) -> list:
    """
    对每个子课题执行研究（复用 Day 5 的 run_research_agent）。

    参数：
        subtopics:  子课题列表
        verbose:    是否打印进度
    返回：
        子报告列表 [{"subtopic": "...", "report": {...}, "status": "..."}, ...]
    """
    # 延迟 import 避免循环依赖
    from research_agent.agent import run_research_agent

    total = len(subtopics)
    reports = []

    for i, subtopic in enumerate(subtopics, 1):
        if verbose:
            print(f"\n{'='*50}")
            print(f"📋 执行子课题 [{i}/{total}]: {subtopic}")
            print(f"{'='*50}")

        try:
            # ★ 关键：复用 Day 5 的 Agent！★
            # 每个子课题就是一个独立的研究任务
            state = run_research_agent(subtopic, max_steps=6, verbose=False)

            reports.append({
                "subtopic": subtopic,
                "report": state.report,
                "status": state.status,
                "steps": state.steps,
                "elapsed": round(state.started_at and
                                 (__import__("time").time() - state.started_at) or 0, 1),
            })

            if verbose:
                conf = state.report.get("confidence", "?") if state.report else "?"
                print(f"  ✓ 完成 (confidence={conf})")

        except Exception as e:
            # 单个子课题失败不影响其他
            print(f"  ✗ 失败: {type(e).__name__}: {e}")
            reports.append({
                "subtopic": subtopic,
                "report": {},
                "status": "error",
                "error": str(e),
            })

    return reports


if __name__ == "__main__":
    print("=== Executor 演示（跑 2 个子课题）===\n")
    subs = ["Python 是什么", "Java 是什么"]
    reports = execute(subs)
    for r in reports:
        print(f"\n{r['subtopic']}: {r['status']}")
