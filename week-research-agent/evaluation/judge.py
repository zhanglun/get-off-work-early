"""
LLM 互评（LLM as a Judge）：用 LLM 给 Agent 的报告打分。

【为什么需要 LLM 互评】
硬指标（成功率/步数/耗时）只能测"过程"，测不了"报告写得好不好"。
报告质量是主观的，人工打分太慢。折中方案：让 LLM 当裁判。

【LLM as a Judge 模式】
用一个 LLM 给另一个 LLM 的输出打分。
- 默认用 GLM-4-Flash 自评（免费，但有"给自己人打高分"偏差）
- 可配置成 GLM-4-Plus 互评（更强模型当裁判，更客观，但付费）

【4 个评分维度】
- relevance（相关性）：报告是否回答了课题
- accuracy（准确性）：内容是否基于素材（没编造）
- completeness（完整性）：关键点是否覆盖
- conciseness（简洁性）：是否啰嗦
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config

# ============================================================
# 默认 judge 模型：可配置
# ============================================================
# 默认用 Flash（免费）。想更客观可换成 "glm-4-plus" 或 "glm-4"。
# 通过 Config 或环境变量 EVAL_JUDGE_MODEL 覆盖。
DEFAULT_JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "glm-4-flash-250414")

# judge 专用的 response_format（强制返回 JSON 打分）
JUDGE_RESPONSE_FORMAT = {
    "type": "json_object",
    "schema": {
        "type": "object",
        "properties": {
            "relevance": {"type": "number", "description": "相关性 1-5 分"},
            "accuracy": {"type": "number", "description": "准确性 1-5 分"},
            "completeness": {"type": "number", "description": "完整性 1-5 分"},
            "conciseness": {"type": "number", "description": "简洁性 1-5 分"},
            "overall_comment": {"type": "string", "description": "一句话总评"},
        },
        "required": ["relevance", "accuracy", "completeness", "conciseness"],
    },
}


JUDGE_PROMPT_TEMPLATE = """你是一个严格的研究报告评审员。请对下面这份研究报告打分。

【研究课题】
{topic}

【研究报告】
{report}

【研究素材】（Agent 搜索/阅读到的原始信息，用于核对报告是否编造）
{findings}

【评分标准】（每项 1-5 分，5 分最好）
- relevance（相关性）：报告是否紧扣课题、回答了用户的问题
- accuracy（准确性）：报告内容是否基于素材，有没有编造（素材没有的不能写）
- completeness（完整性）：关键信息是否覆盖完整，有没有遗漏要点
- conciseness（简洁性）：是否精炼，有没有废话、啰嗦、重复

【特殊情况】
- 如果课题本身无意义（如乱码），报告诚实说明"无法研究"也算高质量
- 如果素材为空但报告编造了内容，accuracy 必须打 1 分

请严格按 JSON 格式返回打分，并给一句话总评。"""


def judge_report(topic: str, report: dict, findings: str,
                 model: str = None) -> dict:
    """
    让 LLM 当裁判，给报告打分。

    参数：
        topic:   研究课题
        report:  Agent 生成的报告 dict（含 summary/key_points/sources/confidence）
        findings: 研究素材文本（用于核对是否编造）
        model:   judge 模型，默认用 DEFAULT_JUDGE_MODEL
    返回：
        打分 dict：{relevance, accuracy, completeness, conciseness, overall_comment}
    """
    model = model or DEFAULT_JUDGE_MODEL
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    # report 可能是空 dict（Agent 失败的情况）
    if not report:
        return _fallback_score(topic, "Agent 未生成报告")

    prompt = JUDGE_PROMPT_TEMPLATE.format(
        topic=topic,
        report=json.dumps(report, ensure_ascii=False, indent=2),
        findings=findings[:3000] if findings else "(无素材)",  # 截断防超长
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # 低温度，让打分稳定
            response_format=JUDGE_RESPONSE_FORMAT,
        )
        raw = response.choices[0].message.content or "{}"
        score = json.loads(raw)

        # 字段校验 + 范围限制（1-5）
        result = {}
        for key in ["relevance", "accuracy", "completeness", "conciseness"]:
            val = score.get(key, 3)
            try:
                val = float(val)
                val = max(1.0, min(5.0, val))  # 钳制到 1-5
            except (TypeError, ValueError):
                val = 3.0
            result[key] = val
        result["overall_comment"] = score.get("overall_comment", "")
        result["judge_model"] = model
        return result

    except json.JSONDecodeError as e:
        return _fallback_score(topic, f"打分 JSON 解析失败：{e}")
    except Exception as e:
        return _fallback_score(topic, f"打分失败：{type(e).__name__}: {e}")


def _fallback_score(topic: str, reason: str) -> dict:
    """打分失败时的兜底（给中性分 3.0，记录原因）。"""
    return {
        "relevance": 3.0,
        "accuracy": 3.0,
        "completeness": 3.0,
        "conciseness": 3.0,
        "overall_comment": f"[评审异常] {reason}",
        "judge_model": "fallback",
    }


if __name__ == "__main__":
    # 演示：用一份假报告测试 judge
    print("=== judge 演示（需要 API Key）===\n")
    fake_report = {
        "summary": "Python 是一种解释型、高级编程语言。",
        "key_points": ["Python 由 Guido van Rossum 创建", "强调代码可读性"],
        "sources": [],
        "confidence": "medium",
    }
    score = judge_report(
        topic="Python 是什么",
        report=fake_report,
        findings="(演示用假素材) Python 是一种编程语言",
    )
    print(json.dumps(score, indent=2, ensure_ascii=False))
