"""
Evaluation CLI 入口。

用法：
    python -m evaluation                  # 跑全部 10 个课题，默认 judge
    python -m evaluation --quick          # 快速模式，只跑前 3 个
    python -m evaluation --judge-model glm-4-plus   # 指定 judge 模型
    python -m evaluation --cases case_001,case_002  # 指定课题
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from evaluation.test_cases import TEST_CASES
from evaluation.runner import run_all_cases, EVAL_RESULTS_DIR
from evaluation.metrics import aggregate_metrics
from evaluation.report import print_terminal_report, save_markdown_report


def parse_args():
    parser = argparse.ArgumentParser(description="Research Agent 评估套件")
    parser.add_argument(
        "--quick", action="store_true",
        help="快速模式：只跑前 3 个课题（easy 验证）",
    )
    parser.add_argument(
        "--judge-model", default=None,
        help="judge 模型（默认 glm-4-flash-250414，可换 glm-4-plus 等）",
    )
    parser.add_argument(
        "--cases", default=None,
        help="指定课题 id，逗号分隔，如 case_001,case_004",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    print("=" * 60)
    print(" 📊 Day 6 Evaluation —— Research Agent 评估")
    print("=" * 60)

    # 选课题
    cases = TEST_CASES
    if args.quick:
        cases = TEST_CASES[:3]
        print(f"\n⚡ 快速模式：只跑前 {len(cases)} 个")
    elif args.cases:
        ids = [x.strip() for x in args.cases.split(",")]
        cases = [c for c in TEST_CASES if c.id in ids]
        if not cases:
            print(f"✗ 没找到匹配的课题：{args.cases}")
            return

    print(f"\n📋 将评估 {len(cases)} 个课题")
    if args.judge_model:
        print(f"   judge 模型：{args.judge_model}")

    # 跑评估
    results = run_all_cases(cases=cases, judge_model=args.judge_model, verbose=True)

    # 算指标
    agg = aggregate_metrics(results)

    # 终端报告
    print_terminal_report(results, agg)

    # Markdown 报告
    md_path = save_markdown_report(results, agg, EVAL_RESULTS_DIR)
    print(f"\n📝 Markdown 报告已存：{md_path}")
    print(f"📁 完整结果在：{EVAL_RESULTS_DIR}/")
    print("=" * 60)


if __name__ == "__main__":
    main()
