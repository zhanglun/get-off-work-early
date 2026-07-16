"""
Planner（规划者）：把大课题拆成子课题。

【职责】
用户给一个"大课题"（如"全面研究 AI Agent"），Planner 把它拆成 3-6 个
可独立研究的子课题（如"主流框架""应用场景""技术挑战"）。

【为什么需要 Planner】
单课题研究只搜一个角度，结果很浅。拆成子课题后，每个子课题独立深度研究，
最后综合——这就是"全面研究"的本质。

【类比】
Planner = 项目经理。接到大需求后，先拆成可执行的小任务，再分配下去。
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config


# Planner 的 prompt：教 LLM 怎么拆课题
PLANNER_PROMPT = """你是一个研究规划师。你的任务是把一个大课题拆解成 3-6 个可独立研究的子课题。

【拆解原则】
1. 子课题之间要互补，合在一起能覆盖大课题的全貌
2. 每个子课题要具体、可独立研究（不是模糊的方向）
3. 子课题数量适中：太少不够全面，太多太碎

【示例】
大课题："全面研究 AI Agent 领域"
子课题：
  1. AI Agent 主流框架对比（LangChain/AutoGen/CrewAI）
  2. AI Agent 典型应用场景
  3. AI Agent 核心技术原理
  4. AI Agent 面临的挑战和局限
  5. AI Agent 未来发展趋势

【大课题】
{topic}

请拆解成子课题，严格按 JSON 格式返回：
{{"subtopics": ["子课题1", "子课题2", ...]}}"""


def plan(topic: str, num_subtopics: int = 5) -> list:
    """
    把大课题拆成子课题。

    参数：
        topic:          大课题
        num_subtopics:  期望的子课题数量（3-6）
    返回：
        子课题列表 ["子课题1", "子课题2", ...]
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)

    prompt = PLANNER_PROMPT.format(topic=topic)

    try:
        response = client.chat.completions.create(
            model=Config.MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,  # 略高温度，让拆解更多样
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        result = json.loads(raw)
        subtopics = result.get("subtopics", [])

        # 兜底：如果拆解失败，返回一个最简单的拆法
        if not subtopics:
            print(f"⚠️ Planner 拆解失败，退化为单课题")
            return [topic]

        # 限制数量
        return subtopics[:num_subtopics]

    except Exception as e:
        print(f"⚠️ Planner 出错：{type(e).__name__}: {e}")
        return [topic]  # 失败则退化为单课题


if __name__ == "__main__":
    print("=== Planner 演示 ===\n")
    subs = plan("全面研究 AI Agent 领域")
    for i, s in enumerate(subs, 1):
        print(f"  {i}. {s}")
