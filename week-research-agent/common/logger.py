"""
公共日志系统：把 Agent 运行过程持久化到文件（Day 4 引入）。

【日志的两个层级】
- 实时日志（run_YYYYMMDD_HHMMSS.log）：一次运行一个文件，过程详细
- 结构化记录（runs.jsonl）：每次运行追加一行 JSON，方便程序分析

Day 5 的 Research Agent 直接复用这套日志，记录研究全过程。
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

    注意：每次调用会生成新的日志文件，挂在 logger.log_file 上。
    """
    # 用带时间戳的唯一名字，避免全局 logger 复用导致 log_file 指向第一次的文件
    unique_name = f"{name}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
    logger = logging.getLogger(unique_name)
    logger.setLevel(logging.DEBUG)

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
