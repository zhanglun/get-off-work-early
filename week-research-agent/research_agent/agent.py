"""
Research Agent 主流程：两步法串联（Day 5 核心）。

【两步法的精髓】
阶段 A（researcher）：研究循环，多轮搜索收集素材
   ↓ findings
阶段 B（reporter）：基于素材生成结构化报告
   ↓ report

两步分离彻底解决了 Day 4 踩坑 3（结构化输出和工具调用互相干扰）：
- 阶段 A 不要求格式，LLM 自由调工具
- 阶段 B 不给工具，LLM 专注生成格式化报告

【为什么单独有个 agent.py】
reearcher.py 和 reporter.py 是两个独立阶段，
agent.py 负责把它们串起来 + 共享 client/logger/state。
这是"编排层"和"执行层"的分离。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from common.logger import setup_logger, save_run_summary
from research_agent.state import ResearchState
from research_agent.researcher import run_research
from research_agent.reporter import run_report


def run_research_agent(topic: str, max_steps: int = 8, verbose: bool = True,
                       history: list = None, on_progress=None) -> ResearchState:
    """
    运行完整的 Research Agent（两步法）。

    参数：
        topic:      研究课题
        max_steps:  阶段 A 最大搜索轮次
        verbose:    是否在终端打印过程
        history:    历史对话 messages（Day 8 Session Memory）。
        on_progress: 进度回调（Day 9 Streaming）。
                     每个关键步骤调用，传入事件 dict。
    返回：
        ResearchState（含完整研究过程 + 结构化报告 + 完整 messages）
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)
    logger = setup_logger("research")

    logger.info("=" * 60)
    logger.info(f"🔬 研究课题：{topic}")
    if history:
        logger.info(f"📚 带历史记忆：{len(history)} 条消息")
    logger.info("=" * 60)

    # 初始化研究状态
    state = ResearchState(max_steps=max_steps)
    state.topic = topic

    # ===== 阶段 A：研究（传入 history + on_progress）=====
    state = run_research(state, client, logger, max_steps=max_steps,
                         history=history, on_progress=on_progress)

    # 即使阶段 A 失败或达到步数上限，也尝试基于已有素材生成报告
    # （Day 4 健壮性：部分失败不影响整体可用）
    if state.status == "error" and not state.findings:
        logger.error("阶段 A 失败且无素材，终止")
        save_run_summary(state, topic, logger)
        return state

    # ===== 阶段 B：报告（透传 on_progress）=====
    state = run_report(state, client, logger, on_progress=on_progress)

    # 保存运行摘要到 JSONL
    save_run_summary(state, topic, logger)

    if verbose:
        logger.info("=" * 60)
        logger.info(state.research_summary())
        logger.info("=" * 60)

    return state


if __name__ == "__main__":
    # 直接跑这个文件：用默认课题演示
    import sys
    topic = sys.argv[1] if len(sys.argv) > 1 else "2026 年主流 AI Agent 框架"
    state = run_research_agent(topic)
    if state.report:
        import json
        print("\n📊 研究报告：")
        print(json.dumps(state.report, indent=2, ensure_ascii=False))
