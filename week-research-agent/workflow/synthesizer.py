"""
Synthesizer（综合者）：把多份子报告合并成一份总报告。

【职责】
Executor 跑完每个子课题后，会有 N 份子报告。
Synthesizer 把它们喂给 LLM，综合成一份连贯的总报告。

【为什么不能简单拼接】
简单拼接 = N 份报告首尾相连，会有大量重复、矛盾、结构混乱。
需要 LLM 做"提炼 + 去重 + 重组"——这就是 Synthesizer 的价值。

【和 reporter 的区别】
- Day 5 reporter：基于单个课题的素材，生成单份报告
- Day 8 synthesizer：基于多份报告，综合成一份更大的报告
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from common.schemas import RESPONSE_FORMAT


SYNTHESIZER_PROMPT = """你是一个研究总编。你的任务是把多份子研究报告综合成一份完整的总报告。

【总课题】
{topic}

【子研究报告】（来自多个子课题的独立研究）
{sub_reports}

【综合原则】
1. 去重：不同子报告里重复的信息只保留一次
2. 重组：按逻辑主题组织，不是简单拼接
3. 提炼：每个要点要精炼，保留最有信息量的内容
4. 覆盖：尽量覆盖所有子报告的核心发现
5. 连贯：总报告要像一份完整的研究，而不是碎片的拼凑

请严格按 JSON 格式输出总报告：
{{
  "summary": "对总课题的全面总结（2-4 句话）",
  "key_points": ["关键发现1", "关键发现2", ...],
  "sources": ["来源1", "来源2", ...],
  "confidence": "high/medium/low"
}}"""


def synthesize(topic: str, sub_reports: list) -> dict:
    """
    把多份子报告综合成一份总报告。

    参数：
        topic:       总课题
        sub_reports: 子报告列表 [{"subtopic": "...", "report": {...}}, ...]
    返回：
        总报告 dict（和单课题报告同结构）
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    # 把子报告格式化成文本
    parts = []
    for i, sr in enumerate(sub_reports, 1):
        sub = sr.get("subtopic", f"子课题{i}")
        report = sr.get("report", {})
        if not report:
            parts.append(f"### {sub}\n（此子课题研究失败，无数据）\n")
            continue
        summary = report.get("summary", "")
        key_points = report.get("key_points", [])
        sources = report.get("sources", [])
        points_text = "\n".join([f"  - {p}" for p in key_points])
        parts.append(f"### {sub}\n摘要：{summary}\n要点：\n{points_text}\n来源：{sources}\n")

    sub_reports_text = "\n---\n".join(parts)

    prompt = SYNTHESIZER_PROMPT.format(topic=topic, sub_reports=sub_reports_text)

    try:
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            response_format=RESPONSE_FORMAT,
        )
        raw = response.choices[0].message.content or "{}"
        result = json.loads(raw)

        # 字段校验
        for key in ["summary", "key_points"]:
            if key not in result:
                result[key] = [] if key == "key_points" else ""
        if "confidence" not in result:
            result["confidence"] = "medium"

        return result

    except Exception as e:
        print(f"⚠️ Synthesizer 出错：{type(e).__name__}: {e}")
        # 兜底：简单拼接所有子报告的要点
        all_points = []
        all_sources = []
        for sr in sub_reports:
            r = sr.get("report", {})
            all_points.extend(r.get("key_points", []))
            all_sources.extend(r.get("sources", []))
        return {
            "summary": f"关于「{topic}」的综合研究（综合器出错，为拼接结果）",
            "key_points": all_points[:10],
            "sources": all_sources[:10],
            "confidence": "low",
        }


if __name__ == "__main__":
    print("=== Synthesizer 演示 ===\n")
    fake_reports = [
        {"subtopic": "Python", "report": {"summary": "Python 是解释型语言", "key_points": ["简单易学"], "sources": ["wiki"]}},
        {"subtopic": "Java", "report": {"summary": "Java 是编译型语言", "key_points": ["跨平台"], "sources": ["oracle"]}},
    ]
    result = synthesize("Python 和 Java 对比", fake_reports)
    print(json.dumps(result, indent=2, ensure_ascii=False))
