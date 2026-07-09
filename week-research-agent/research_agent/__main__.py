"""
Research Agent 的 CLI 入口。

运行方式：
    python -m research_agent

进入交互式命令行，输入研究课题，Agent 自主研究并输出结构化报告。
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from research_agent.agent import run_research_agent


def print_report(state):
    """漂亮地打印研究报告。"""
    print(f"\n{'='*60}")
    if state.status == "error" and not state.report:
        print(f"❌ 研究失败：{state.error}")
    elif state.report:
        r = state.report
        print(f"📊 研究报告：{state.topic}")
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
            for i, s in enumerate(src[:5], 1):  # 最多显示 5 个
                print(f"   {i}. {s}")
            if len(src) > 5:
                print(f"   ... 还有 {len(src)-5} 个")

        conf = r.get("confidence", "?")
        conf_mark = {"high": "🟢", "medium": "🟡", "low": "🔴"}.get(conf, "⚪")
        print(f"\n{conf_mark} 置信度：{conf}")
    else:
        print(f"⚠️ 未能生成报告（状态：{state.status}）")
    print(f"{'='*60}")


def main():
    print("=" * 60)
    print(" 🔬 Research Agent —— 完整研究助手")
    print(" 给我一个课题，我帮你联网研究并生成报告")
    print("=" * 60)
    print(" 试试这些课题：")
    print("   • 2026 年主流 AI Agent 框架对比")
    print("   • GLM-4 和 GPT-4 的区别")
    print("   • Python 3.13 有什么新特性")
    print(" 输入 quit 退出")
    print("-" * 60)

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

        # 运行研究（过程会通过 logger 实时打印到终端）
        state = run_research_agent(topic, max_steps=8, verbose=True)

        # 打印最终报告
        print_report(state)


if __name__ == "__main__":
    main()
