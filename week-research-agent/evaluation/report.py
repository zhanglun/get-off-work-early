"""
评估报告生成：终端展示 + Markdown 文件。

【两种输出】
1. 终端表格：跑完立刻看到结果
2. Markdown 文件：存档、可分享、可对比历史版本
"""
import os
from datetime import datetime
from typing import List

from evaluation.metrics import CaseResult, aggregate_metrics


# ============================================================
# 终端报告
# ============================================================
def print_terminal_report(results: List[CaseResult], agg: dict) -> None:
    """打印终端版评估报告。"""
    print("\n" + "=" * 60)
    print(" 📊 Research Agent 评估报告")
    print("=" * 60)

    hard = agg.get("hard", {})
    soft = agg.get("soft", {})
    by_diff = agg.get("by_difficulty", {})

    # ---- 硬指标 ----
    print("\n【硬指标】" + f"（基于 {hard.get('total_cases', 0)} 个测试课题）")
    sr = hard.get("success_rate", 0)
    sr_mark = "🟢" if sr >= 0.8 else "🟡" if sr >= 0.5 else "🔴"
    print(f"  {sr_mark} 成功率:      {hard.get('success_count',0)}/{hard.get('total_cases',0)} = {sr*100:.1f}%")
    print(f"  ⏱  平均步数:      {hard.get('avg_steps', 0):.1f}")
    print(f"  ⏱  平均耗时:      {hard.get('avg_elapsed', 0):.1f} 秒")
    print(f"  🔧 平均工具调用:  {hard.get('avg_tool_calls', 0):.1f} 次")

    # 工具成功率
    tsr = hard.get("tool_success_rate", {})
    if tsr:
        print(f"  🔧 工具成功率:")
        for tool, rate in tsr.items():
            mark = "🟢" if rate >= 0.8 else "🟡" if rate >= 0.5 else "🔴"
            print(f"     {mark} {tool}: {rate*100:.0f}%")

    # 工具匹配率
    tmr = hard.get("tool_match_rate")
    if tmr is not None:
        mark = "🟢" if tmr >= 0.7 else "🟡"
        print(f"  🎯 工具选择匹配:  {mark} {tmr*100:.0f}%（预期工具被正确使用）")

    # ---- 软指标 ----
    print("\n【软指标】" + f"（LLM 互评，{soft.get('scored_count', 0)} 份报告）")
    if "error" in soft:
        print(f"  ⚠️ {soft['error']}")
    else:
        for key, label in [("relevance", "相关性"), ("accuracy", "准确性"),
                           ("completeness", "完整性"), ("conciseness", "简洁性")]:
            val = soft.get(key, 0)
            bar = "█" * int(val) + "░" * (5 - int(val))
            print(f"  {label}: {bar} {val:.1f} / 5")
        overall = soft.get("overall", 0)
        mark = "🟢" if overall >= 4.0 else "🟡" if overall >= 3.0 else "🔴"
        print(f"  {mark} 综合质量: {overall:.1f} / 5")

    # ---- 分难度表现 ----
    if by_diff:
        print("\n【分场景表现】")
        print(f"  {'难度':<8} {'成功率':<10} {'平均步数':<10} {'平均分':<10}")
        print(f"  {'-'*38}")
        for diff in ["easy", "medium", "hard", "edge"]:
            if diff not in by_diff:
                continue
            d = by_diff[diff]
            sr = d["success_rate"]
            score = d.get("avg_score")
            score_str = f"{score:.1f}" if score else "-"
            mark = "🟢" if sr >= 0.8 else "🟡" if sr >= 0.5 else "🔴"
            print(f"  {diff:<8} {mark} {sr*100:>5.0f}%   {d['avg_steps']:<10.1f} {score_str:<10}")

    # ---- 每个 case 的明细 ----
    print("\n【单个课题明细】")
    for r in results:
        ok = "✓" if r.success else "✗"
        tools = ",".join(r.actual_tools) if r.actual_tools else "-"
        score = ""
        if r.scores and "relevance" in r.scores:
            avg = sum(r.scores[k] for k in ["relevance","accuracy","completeness","conciseness"]) / 4
            score = f" | 分 {avg:.1f}"
        comment = r.scores.get("overall_comment", "")[:30]
        print(f"  {ok} [{r.difficulty:6}] {r.topic[:25]:<25} | {tools}{score}")
        if comment and comment != "[评审异常]":
            print(f"           → {comment}")

    print("\n" + "=" * 60)


# ============================================================
# Markdown 报告
# ============================================================
def save_markdown_report(results: List[CaseResult], agg: dict,
                         eval_results_dir: str) -> str:
    """生成 Markdown 版评估报告，返回文件路径。"""
    hard = agg.get("hard", {})
    soft = agg.get("soft", {})
    by_diff = agg.get("by_difficulty", {})
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# Research Agent 评估报告",
        f"",
        f"> 生成时间：{now}",
        f"> 测试课题数：{hard.get('total_cases', 0)}",
        f"> judge 模型：{results[0].scores.get('judge_model', '?') if results else '?'}",
        f"",
        f"## 硬指标",
        f"",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| 成功率 | {hard.get('success_count',0)}/{hard.get('total_cases',0)} = {hard.get('success_rate',0)*100:.1f}% |",
        f"| 平均步数 | {hard.get('avg_steps',0):.1f} |",
        f"| 平均耗时 | {hard.get('avg_elapsed',0):.1f}s |",
        f"| 平均工具调用 | {hard.get('avg_tool_calls',0):.1f} |",
    ]

    tmr = hard.get("tool_match_rate")
    if tmr is not None:
        lines.append(f"| 工具选择匹配率 | {tmr*100:.0f}% |")

    # 工具成功率
    tsr = hard.get("tool_success_rate", {})
    if tsr:
        lines.append("")
        lines.append("### 工具成功率")
        lines.append("")
        lines.append("| 工具 | 成功率 |")
        lines.append("|------|--------|")
        for tool, rate in tsr.items():
            lines.append(f"| {tool} | {rate*100:.0f}% |")

    # 软指标
    lines.append("")
    lines.append("## 软指标（LLM 互评）")
    lines.append("")
    if "error" in soft:
        lines.append(f"⚠️ {soft['error']}")
    else:
        lines.append("| 维度 | 分数 |")
        lines.append("|------|------|")
        for key, label in [("relevance","相关性"),("accuracy","准确性"),
                           ("completeness","完整性"),("conciseness","简洁性")]:
            lines.append(f"| {label} | {soft.get(key,0):.1f} / 5 |")
        lines.append(f"| **综合** | **{soft.get('overall',0):.1f} / 5** |")

    # 分难度
    if by_diff:
        lines.append("")
        lines.append("## 分难度表现")
        lines.append("")
        lines.append("| 难度 | 课题数 | 成功率 | 平均步数 | 平均分 |")
        lines.append("|------|--------|--------|----------|--------|")
        for diff in ["easy","medium","hard","edge"]:
            if diff not in by_diff:
                continue
            d = by_diff[diff]
            score = d.get("avg_score")
            score_str = f"{score:.1f}" if score else "-"
            lines.append(f"| {diff} | {d['count']} | {d['success_rate']*100:.0f}% | {d['avg_steps']:.1f} | {score_str} |")

    # 明细
    lines.append("")
    lines.append("## 单个课题明细")
    lines.append("")
    lines.append("| 状态 | 难度 | 课题 | 实际工具 | 步数 | 耗时 | 评分 | judge 评语 |")
    lines.append("|------|------|------|----------|------|------|------|-----------|")
    for r in results:
        ok = "✓" if r.success else "✗"
        tools = ",".join(r.actual_tools) if r.actual_tools else "-"
        score = "-"
        if r.scores and "relevance" in r.scores:
            avg = sum(r.scores[k] for k in ["relevance","accuracy","completeness","conciseness"]) / 4
            score = f"{avg:.1f}"
        comment = r.scores.get("overall_comment", "").replace("|", "/")[:40]
        topic = r.topic.replace("|", "/")[:25]
        lines.append(f"| {ok} | {r.difficulty} | {topic} | {tools} | {r.steps} | {r.elapsed:.0f}s | {score} | {comment} |")

    filepath = os.path.join(eval_results_dir, "eval_report.md")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return filepath
