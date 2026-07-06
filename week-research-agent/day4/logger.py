"""
Day 4 - 日志系统：把 Agent 运行过程持久化到文件。

【Day 3 的局限】
state.summary() 只能打印到屏幕，关掉终端就没了。
Day 4 把每次运行写成日志文件，事后能查、能审计、能统计。

【日志系统的作用】
1. 审计：出问题时能回查"当时 Agent 到底干了什么"
2. 统计：长期收集日志，能分析成功率、平均步数、平均耗时
3. 调试：开发时看日志比 print 更结构化、更可过滤

【日志的两个层级】
- 实时日志（run_YYYYMMDD_HHMMSS.log）：一次运行一个文件，过程详细
- 结构化记录（runs.jsonl）：每次运行追加一行 JSON，方便程序分析
"""
import json
import os
import sys
import time
import logging
from datetime import datetime

# 把日志统一放在项目根的 logs/ 目录
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# JSONL 格式的"运行汇总"文件（每次运行追加一行）
RUNS_JSONL = os.path.join(LOG_DIR, "runs.jsonl")


def setup_logger(name: str = "agent") -> logging.Logger:
    """
    创建一个 logger，把日志同时写到文件和终端。

    返回的 logger 用法：
        logger.info("xxx")
        logger.error("xxx")
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)  # 全开，由 handler 自己决定记到什么级别

    # 避免重复添加 handler（重复调用时）
    if logger.handlers:
        return logger

    # 本次运行的独立日志文件（带时间戳）
    log_file = os.path.join(LOG_DIR, f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    ))

    # 终端只显示重要信息（INFO 及以上），避免太吵
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter("%(message)s"))

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    # 在 logger 上记录本次日志文件路径，方便外面拿
    logger.log_file = log_file

    return logger


def save_run_summary(state, user_input: str, logger: logging.Logger):
    """
    把一次运行的摘要存成 JSONL（每次运行追加一行）。

    JSONL = JSON Lines，每行一个 JSON 对象。
    好处：可以用 grep/jq/python 快速分析历史运行。
    """
    summary = {
        "timestamp": datetime.now().isoformat(),
        "user_input": user_input,
        "status": state.status,
        "steps": state.steps,
        "max_steps": state.max_steps,
        "tool_calls": len(state.tool_history),
        "tool_names": list({tc.tool_name for tc in state.tool_history}),
        "elapsed_sec": round(time.time() - state.started_at, 2),
        "final_answer_length": len(state.final_answer),
        "error": state.error,
        "log_file": getattr(logger, "log_file", ""),
    }
    with open(RUNS_JSONL, "a", encoding="utf-8") as f:
        f.write(json.dumps(summary, ensure_ascii=False) + "\n")
    return summary


# ============================================================
# 演示：日志系统长什么样
# ============================================================
if __name__ == "__main__":
    print("=== Day 4 日志系统演示 ===\n")

    # 1. 创建 logger
    logger = setup_logger("demo")
    print(f"本次日志文件：{logger.log_file}\n")

    # 2. 不同级别的日志
    logger.info("这是一条 INFO（终端能看到）")
    logger.warning("这是一条 WARNING")
    logger.error("这是一条 ERROR")
    logger.debug("这是一条 DEBUG（只进文件，终端看不到）")

    # 3. 模拟一次运行摘要
    class FakeState:
        status = "finished"
        steps = 2
        max_steps = 8
        tool_history = [type("R", (), {"tool_name": "search_web"})(),
                        type("R", (), {"tool_name": "add"})()]
        started_at = time.time() - 3.5
        final_answer = "这是答案"
        error = ""

    summary = save_run_summary(FakeState(), "演示问题", logger)
    print(f"\n运行摘要已追加到：{RUNS_JSONL}")
    print(f"摘要内容：")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    print(f"\n现在去看 {LOG_DIR} 目录，里面有完整的日志文件。")
