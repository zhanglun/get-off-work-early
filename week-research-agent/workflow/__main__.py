"""
Workflow CLI 入口。

用法：
    python -m workflow                    # 交互式
    python -m workflow "全面研究 AI Agent"  # 直接给课题
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from workflow.agent import run_workflow_agent


def main():
    print("=" * 60)
    print(" 🏗️  Workflow Agent——大课题深度研究")
    print(" 给我一个大的研究课题，我会拆解、逐个深研、综合")
    print("=" * 60)
    print(" 试试这些大课题：")
    print("   • 全面研究 AI Agent 领域")
    print("   • 深入了解 RAG 技术全貌")
    print("   • Python 和 JavaScript 全方位对比")
    print(" 输入 quit 退出")
    print("-" * 60)

    # 支持命令行参数直接传课题
    if len(sys.argv) > 1:
        topic = " ".join(sys.argv[1:])
        result = run_workflow_agent(topic, verbose=True)
        print_report(result)
        return

    while True:
        try:
            topic = input("\n课题 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if not topic:
            continue
        if topic.lower() in ("quit", "exit", "q"):
            print("再见！")
            break

        result = run_workflow_agent(topic, verbose=True)
        print_report(result)


def print_report(result):
    """漂亮地打印总报告。"""
    r = result["report"]
    info = result["workflow_info"]

    print(f"\n{'='*60}")
    print(f"📊 总研究报告：{result['topic']}")
    print(f"{'='*60}")
    print(f"\n📝 摘要：\n{r.get('summary', '(无)')}")

    kp = r.get("key_points", [])
    if kp:
        print(f"\n🔑 关键发现（{len(kp)} 条）：")
        for i, p in enumerate(kp, 1):
            print(f"   {i}. {p}")

    src = r.get("sources", [])
    if src:
        print(f"\n📎 来源（{len(src)} 个）：")
        for i, s in enumerate(src[:5], 1):
            print(f"   {i}. {s}")

    conf = r.get("confidence", "?")
    mark = {"high": "🟢", "medium": "🟡", "low": "🔴"}.get(conf, "⚪")
    print(f"\n{mark} 置信度：{conf}")

    if info.get("mode") == "workflow":
        print(f"\n🏗️  Workflow 信息：{info.get('sub_reports_count')} 个子课题已综合")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
