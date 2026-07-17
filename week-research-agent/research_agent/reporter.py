"""
阶段 B：报告生成（reporter）。

【职责】
拿到阶段 A 收集的 findings，生成结构化 JSON 研究报告。

【两步法的关键——和阶段 A 完全隔离】
- 不传 tools 参数 → LLM 不能调工具，只能基于已有素材回答
- 传 response_format → 强制 JSON 输出
- 不传 System Prompt（研究身份）→ 换成单纯的"报告生成"任务

这样就彻底避免了 Day 4 踩坑 3 的"结构化输出和工具调用互相干扰"。

【为什么单独一个函数/文件】
关注点分离：researcher 负责"收集"，reporter 负责"综合"。
两边可以独立迭代（比如以后换更强大的报告生成模型）。
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
import logging
from config import Config
from common.schemas import RESPONSE_FORMAT
from research_agent.prompts import REPORTER_USER_TEMPLATE
from research_agent.state import ResearchState


def run_report(state: ResearchState, client: ZhipuAI,
               logger: logging.Logger, on_progress=None) -> ResearchState:
    """
    阶段 B：基于 findings 生成结构化报告。

    参数：
        state:      ResearchState（findings 已被阶段 A 填充）
        client:     ZhipuAI 客户端
        logger:     日志器
        on_progress: 进度回调（Day 9 Streaming）
    返回：
        更新后的 state（report 字段被填充为 dict）
    """

    def _emit(event: dict):
        if on_progress:
            try:
                on_progress(event)
            except Exception:
                pass

    logger.info("📊 阶段 B 开始生成报告")
    _emit({"event": "phase", "phase": "report"})

    if not state.findings or state.findings.startswith("(本次研究未获得"):
        logger.warning("⚠️ 没有可用素材，跳过报告生成")
        state.report = {
            "summary": f"未能获取关于「{state.topic}」的有效信息。",
            "key_points": ["研究过程中未获得有效搜索结果，可能是网络问题或课题过于冷门。"],
            "sources": [],
            "confidence": "low",
        }
        _emit({"event": "phase_done", "phase": "report", "skipped": True})
        return state

    try:
        # 构造报告生成的 prompt
        user_prompt = REPORTER_USER_TEMPLATE.format(
            topic=state.topic,
            findings=state.findings,
        )

        # 关键：不传 tools，只传 response_format
        # LLM 只能基于 findings 生成 JSON，不能调工具，也不会被工具分散注意力
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=[{"role": "user", "content": user_prompt}],
            temperature=Config.TEMPERATURE,
            response_format=RESPONSE_FORMAT,
        )
        raw = response.choices[0].message.content or ""

        # 解析 JSON（三层防护：API 参数 + prompt 要求 + 解析校验）
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error(f"报告 JSON 解析失败：{e}")
            logger.error(f"原始输出：{raw[:300]}")
            state.report = {
                "summary": "报告生成格式异常。",
                "key_points": [f"LLM 返回的内容无法解析为 JSON。原始输出前 200 字：{raw[:200]}"],
                "sources": [],
                "confidence": "low",
            }
            return state

        # 字段完整性校验
        required = ["summary", "key_points", "confidence"]
        missing = [k for k in required if k not in parsed]
        if missing:
            logger.warning(f"报告缺少字段：{missing}")
            for k in missing:
                parsed[k] = [] if k == "key_points" else ""

        state.report = parsed
        logger.info(f"✓ 报告生成成功：confidence={parsed.get('confidence', '?')}, "
                    f"key_points={len(parsed.get('key_points', []))} 条")
        _emit({"event": "phase_done", "phase": "report",
               "confidence": parsed.get('confidence', '?'),
               "key_points": len(parsed.get('key_points', []))})

    except Exception as e:
        state.status = "error"
        state.error = f"报告生成出错：{type(e).__name__}: {e}"
        logger.error(f"❌ {state.error}")
        _emit({"event": "error", "phase": "report", "error": state.error})

    return state
