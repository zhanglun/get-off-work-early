"""
指标计算：从单个 case 结果算硬指标 + 软指标聚合。

【两类指标】
硬指标（客观，从 state 算）：
  - success:          Agent 是否正常完成
  - steps:            执行步数
  - elapsed:          总耗时
  - tool_calls:       工具调用总次数
  - tool_success_rate: 工具成功率（按工具分）
  - tool_match:       工具选择合理性（实际用的 vs 预期）

软指标（主观，从 judge 打分算）：
  - relevance / accuracy / completeness / conciseness
"""
from dataclasses import dataclass
from typing import List, Dict
from statistics import mean


@dataclass
class CaseResult:
    """单个测试课题的完整结果（runner 产出，metrics 消费）。"""
    # ---- 测试课题元信息 ----
    id: str
    topic: str
    difficulty: str
    expected_tools: List[str]

    # ---- 硬指标（从 state 来）----
    success: bool                    # status == "finished"
    status: str                      # finished / max_steps_reached / error
    steps: int
    elapsed: float                   # 秒
    actual_tools: List[str]          # 实际用过的工具名（去重）
    tool_history_summary: List[dict] # [{name, success, elapsed}, ...]

    # ---- 报告 ----
    report: dict                     # Agent 的最终报告
    findings_length: int             # 素材长度

    # ---- 软指标（从 judge 来）----
    scores: dict                     # judge 打分


# ============================================================
# 单个 case 的硬指标计算
# ============================================================
def compute_tool_success_rate(tool_history: List[dict]) -> Dict[str, float]:
    """
    按工具分别计算成功率。

    返回 {"search_web": 0.8, "fetch_url": 1.0, ...}
    """
    by_tool = {}
    for th in tool_history:
        name = th.get("name", "?")
        if name not in by_tool:
            by_tool[name] = {"ok": 0, "total": 0}
        by_tool[name]["total"] += 1
        if th.get("success"):
            by_tool[name]["ok"] += 1

    return {name: v["ok"] / v["total"] for name, v in by_tool.items()}


def compute_tool_match(expected: List[str], actual: List[str]) -> dict:
    """
    工具选择合理性：实际用的工具 vs 预期。

    返回 {match: bool, missing: [...], extra: [...]}
    - match: 预期的工具都用了
    - missing: 预期要用但没用的
    - extra: 没预期但用了的
    """
    expected_set = set(expected)
    actual_set = set(actual)
    missing = expected_set - actual_set
    extra = actual_set - expected_set
    return {
        "match": len(missing) == 0,
        "missing": list(missing),
        "extra": list(extra),
    }


# ============================================================
# 批量聚合（所有 case 的指标汇总）
# ============================================================
def aggregate_metrics(results: List[CaseResult]) -> dict:
    """
    汇总所有 case 的指标，返回评估总结。

    返回 dict 含：硬指标聚合 + 软指标聚合 + 分难度统计
    """
    total = len(results)
    if total == 0:
        return {"error": "无结果"}

    # ---- 硬指标聚合 ----
    success_count = sum(1 for r in results if r.success)
    finished_results = [r for r in results if r.success]

    hard = {
        "total_cases": total,
        "success_count": success_count,
        "success_rate": success_count / total,
        "avg_steps": mean(r.steps for r in results),
        "avg_elapsed": mean(r.elapsed for r in results),
        "avg_tool_calls": mean(len(r.tool_history_summary) for r in results),
    }

    # 工具成功率（跨所有 case 聚合）
    all_tool_calls = []
    for r in results:
        all_tool_calls.extend(r.tool_history_summary)
    hard["tool_success_rate"] = compute_tool_success_rate(all_tool_calls)

    # 工具匹配率（预期工具都用了的比例）
    match_count = 0
    for r in results:
        if not r.expected_tools:
            continue  # edge case 没有预期，跳过
        m = compute_tool_match(r.expected_tools, r.actual_tools)
        if m["match"]:
            match_count += 1
    cases_with_expectation = sum(1 for r in results if r.expected_tools)
    hard["tool_match_rate"] = (
        match_count / cases_with_expectation if cases_with_expectation > 0 else None
    )

    # ---- 软指标聚合（只在成功的 case 上算）----
    scored = [r for r in finished_results if r.scores and "relevance" in r.scores]
    soft = {}
    if scored:
        for key in ["relevance", "accuracy", "completeness", "conciseness"]:
            soft[key] = mean(r.scores[key] for r in scored)
        soft["overall"] = mean([soft[k] for k in ["relevance", "accuracy",
                                                   "completeness", "conciseness"]])
        soft["scored_count"] = len(scored)
    else:
        soft = {"error": "无有效打分"}

    # ---- 分难度统计 ----
    by_difficulty = {}
    for diff in ["easy", "medium", "hard", "edge"]:
        diff_results = [r for r in results if r.difficulty == diff]
        if not diff_results:
            continue
        diff_success = sum(1 for r in diff_results if r.success)
        diff_scored = [r for r in diff_results if r.success and r.scores and "relevance" in r.scores]
        by_difficulty[diff] = {
            "count": len(diff_results),
            "success_rate": diff_success / len(diff_results),
            "avg_steps": mean(r.steps for r in diff_results),
            "avg_score": (
                mean(
                    (r.scores["relevance"] + r.scores["accuracy"] +
                     r.scores["completeness"] + r.scores["conciseness"]) / 4
                    for r in diff_scored
                ) if diff_scored else None
            ),
        }

    return {
        "hard": hard,
        "soft": soft,
        "by_difficulty": by_difficulty,
    }


if __name__ == "__main__":
    # 演示：构造几个假结果测试聚合
    print("=== metrics 演示 ===\n")
    fake = [
        CaseResult(
            id="case_001", topic="测试1", difficulty="easy",
            expected_tools=["search_web"],
            success=True, status="finished", steps=2, elapsed=15.0,
            actual_tools=["search_web"],
            tool_history_summary=[{"name": "search_web", "success": True, "elapsed": 5}],
            report={"summary": "x"}, findings_length=100,
            scores={"relevance": 5, "accuracy": 4, "completeness": 4, "conciseness": 5},
        ),
        CaseResult(
            id="case_002", topic="测试2", difficulty="hard",
            expected_tools=["search_web", "fetch_url"],
            success=False, status="error", steps=1, elapsed=30.0,
            actual_tools=["search_web"],
            tool_history_summary=[{"name": "search_web", "success": False, "elapsed": 30}],
            report={}, findings_length=0,
            scores={},
        ),
    ]
    agg = aggregate_metrics(fake)
    import json
    print(json.dumps(agg, indent=2, ensure_ascii=False))
