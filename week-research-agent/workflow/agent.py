"""
Workflow Agent：编排 Planner → Executor → Synthesizer 三步。

【这是 Day 8 的核心】
单课题 Agent（Day 5）：topic → search → report（浅）
Workflow Agent（Day 8）：topic → plan → execute × N → synthesize（深）

【编排逻辑】
1. 判断：这个课题需要 Workflow 吗？
   - 简单课题（"Python 是什么"）→ 直接用 Day 5 Agent
   - 大课题（"全面研究 AI Agent"）→ 用 Workflow
2. 如果用 Workflow：Planner 拆解 → Executor 逐个执行 → Synthesizer 综合
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from workflow.planner import plan
from workflow.executor import execute
from workflow.synthesizer import synthesize


def run_workflow_agent(topic: str, use_workflow: bool = True,
                       num_subtopics: int = 5, verbose: bool = True) -> dict:
    """
    运行 Workflow Agent（大课题深度研究）。

    参数：
        topic:          研究课题
        use_workflow:   是否用 Workflow（False 则退化为单课题）
        num_subtopics:  Planner 期望拆几个子课题
        verbose:        是否打印进度
    返回：
        dict 含：{topic, report, workflow_info}
    """
    start = time.time()

    if not use_workflow:
        # 退化模式：直接用 Day 5 单课题 Agent
        from research_agent.agent import run_research_agent
        if verbose:
            print(f"🔄 单课题模式（不拆解）")
        state = run_research_agent(topic, verbose=verbose)
        return {
            "topic": topic,
            "report": state.report,
            "workflow_info": {"mode": "single", "subtopics": [topic]},
        }

    # ===== Workflow 模式 =====
    if verbose:
        print(f"\n{'='*60}")
        print(f"🏗️  Workflow Agent：{topic}")
        print(f"{'='*60}")

    # 步骤 1：Planner 拆解
    if verbose:
        print(f"\n📝 步骤 1/3：Planner 拆解课题...")
    subtopics = plan(topic, num_subtopics=num_subtopics)
    if verbose:
        print(f"   拆出 {len(subtopics)} 个子课题：")
        for i, s in enumerate(subtopics, 1):
            print(f"   {i}. {s}")

    # 步骤 2：Executor 逐个执行
    if verbose:
        print(f"\n🔨 步骤 2/3：Executor 逐个研究...")
    sub_reports = execute(subtopics, verbose=verbose)

    # 步骤 3：Synthesizer 综合
    if verbose:
        print(f"\n📊 步骤 3/3：Synthesizer 综合总报告...")
    final_report = synthesize(topic, sub_reports)

    elapsed = time.time() - start
    if verbose:
        conf = final_report.get("confidence", "?")
        print(f"\n{'='*60}")
        print(f"✅ Workflow 完成：{len(subtopics)} 子课题，耗时 {elapsed:.0f}s，confidence={conf}")
        print(f"{'='*60}")

    return {
        "topic": topic,
        "report": final_report,
        "workflow_info": {
            "mode": "workflow",
            "subtopics": subtopics,
            "sub_reports_count": len(sub_reports),
            "elapsed": round(elapsed, 1),
        },
    }
