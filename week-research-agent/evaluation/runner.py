"""
批量执行：对每个 benchmark 课题跑 Agent + 调 judge，收集结果。

【职责】
1. 遍历 test_cases.py 的课题
2. 对每个课题调 run_research_agent（Day 5 的产品）
3. 调 judge_report 给报告打分
4. 打包成 CaseResult 存到 eval_results/

【为什么不并行】
串行更简单，且避免 LLM API 限流。
评估是低频操作（改 Agent 后跑一次），不值得引入并发复杂度。
"""
import json
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evaluation.test_cases import TEST_CASES, TestCase
from evaluation.judge import judge_report
from evaluation.metrics import CaseResult
from common.state import ToolCallRecord  # type hint 用

# 评估结果存储目录
EVAL_RESULTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "eval_results",
)
os.makedirs(EVAL_RESULTS_DIR, exist_ok=True)


def run_single_case(test_case: TestCase, judge_model: str = None,
                    verbose: bool = True) -> CaseResult:
    """
    跑单个测试课题：Agent 研究 + judge 打分。

    参数：
        test_case:    测试课题
        judge_model:  judge 用的模型（None 用默认）
        verbose:      是否打印进度
    返回：
        CaseResult
    """
    if verbose:
        print(f"\n{'='*50}")
        print(f"[{test_case.difficulty}] {test_case.id}: {test_case.topic}")
        print(f"{'='*50}")

    # ---- 第 1 步：跑 Agent（复用 Day 5）----
    # 延迟 import 避免循环依赖
    from research_agent.agent import run_research_agent

    start = time.time()
    # verbose=False：评估时不要 Agent 的 logger 打到终端（自己控制输出）
    state = run_research_agent(test_case.topic, max_steps=8, verbose=False)
    agent_elapsed = time.time() - start

    if verbose:
        status_mark = "✓" if state.status == "finished" else "✗"
        print(f"  {status_mark} Agent 完成：{state.status}，{state.steps}步，{agent_elapsed:.1f}s")

    # ---- 第 2 步：调 judge 打分 ----
    scores = {}
    if state.report:
        scores = judge_report(
            topic=test_case.topic,
            report=state.report,
            findings=state.findings,
            model=judge_model,
        )
        if verbose:
            overall = sum(scores.get(k, 0) for k in
                         ["relevance", "accuracy", "completeness", "conciseness"]) / 4
            print(f"  📊 judge 打分：{overall:.1f}/5 ({scores.get('overall_comment','')[:30]})")

    # ---- 第 3 步：打包成 CaseResult ----
    tool_history_summary = [
        {
            "name": tc.tool_name,
            "success": tc.success,
            "elapsed": tc.elapsed,
        }
        for tc in state.tool_history
    ]
    actual_tools = list({tc.tool_name for tc in state.tool_history})

    result = CaseResult(
        id=test_case.id,
        topic=test_case.topic,
        difficulty=test_case.difficulty,
        expected_tools=test_case.expected_tools,
        success=(state.status == "finished"),
        status=state.status,
        steps=state.steps,
        elapsed=agent_elapsed,
        actual_tools=actual_tools,
        tool_history_summary=tool_history_summary,
        report=state.report,
        findings_length=len(state.findings),
        scores=scores,
    )

    # 存到文件（每个 case 一个 json，方便单独查看）
    result_file = os.path.join(EVAL_RESULTS_DIR, f"{test_case.id}.json")
    _save_case_result(result, result_file, state)

    return result


def _save_case_result(result: CaseResult, filepath: str, state) -> None:
    """把单个 case 的完整结果存成 json（含 state 的工具调用明细）。"""
    data = {
        "case": {
            "id": result.id,
            "topic": result.topic,
            "difficulty": result.difficulty,
            "expected_tools": result.expected_tools,
        },
        "hard_metrics": {
            "success": result.success,
            "status": result.status,
            "steps": result.steps,
            "elapsed": result.elapsed,
            "actual_tools": result.actual_tools,
            "findings_length": result.findings_length,
        },
        "tool_calls_detail": [
            {"step": tc.step, "name": tc.tool_name, "args": tc.arguments,
             "success": tc.success, "elapsed": tc.elapsed}
            for tc in state.tool_history
        ],
        "report": result.report,
        "judge_scores": result.scores,
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def run_all_cases(cases=None, judge_model: str = None,
                  verbose: bool = True) -> list:
    """
    跑全部 benchmark 课题。

    参数：
        cases:        指定课题子集（None 表示跑全部）
        judge_model:  judge 模型
        verbose:      是否打印进度
    返回：
        List[CaseResult]
    """
    cases = cases or TEST_CASES
    results = []
    total = len(cases)
    start_time = time.time()

    print(f"\n🚀 开始评估：共 {total} 个课题")
    print(f"   judge 模型：{judge_model or '(默认)'}")

    for i, tc in enumerate(cases, 1):
        print(f"\n[{i}/{total}] ", end="")
        try:
            result = run_single_case(tc, judge_model=judge_model, verbose=verbose)
            results.append(result)
        except Exception as e:
            # 单个 case 失败不影响整体评估
            print(f"  ✗ EXCEPTION: {type(e).__name__}: {e}")
            results.append(CaseResult(
                id=tc.id, topic=tc.topic, difficulty=tc.difficulty,
                expected_tools=tc.expected_tools,
                success=False, status="exception", steps=0, elapsed=0,
                actual_tools=[], tool_history_summary=[],
                report={}, findings_length=0,
                scores={"overall_comment": f"评估异常：{e}"},
            ))

    total_time = time.time() - start_time
    success_count = sum(1 for r in results if r.success)
    print(f"\n{'='*50}")
    print(f"🏁 评估完成：{success_count}/{total} 成功，总耗时 {total_time:.0f}s")
    print(f"   结果存于：{EVAL_RESULTS_DIR}")
    print(f"{'='*50}")

    return results


if __name__ == "__main__":
    # 快速测试：只跑前 2 个 case
    print("=== runner 演示（只跑前 2 个）===\n")
    results = run_all_cases(cases=TEST_CASES[:2])
    print(f"\n完成 {len(results)} 个")
