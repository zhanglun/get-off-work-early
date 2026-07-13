"""
Day 6 测试课题集（benchmark）。

【什么是 benchmark】
评估 Agent 不能随便拿几个问题跑，要有精心设计的"标准题库"。
每个课题标注：难度、预期会用到哪些工具、考察什么能力。
这样评估结果才有可比性、可追踪。

【4 档难度的设计意图】
- easy：   基本能力（能搜到吗）
- medium： 多角度/该深读时深读（搜得聪明吗）
- hard：   复杂对比/技术深度（搜得深吗）
- edge：   异常输入（失败时优雅吗）
"""
from dataclasses import dataclass, field
from typing import List


@dataclass
class TestCase:
    """一个测试课题。"""
    id: str                              # 唯一标识（case_001）
    topic: str                           # 研究课题
    difficulty: str                      # easy / medium / hard / edge
    expected_tools: List[str] = field(default_factory=list)  # 预期会用到的工具
    notes: str = ""                      # 考察点说明


# ============================================================
# 10 个 benchmark 课题（4 档难度）
# ============================================================
TEST_CASES: List[TestCase] = [
    # ---- easy：基本搜索能力 ----
    TestCase(
        id="case_001",
        topic="Python 是什么",
        difficulty="easy",
        expected_tools=["search_web"],
        notes="最简单的事实查询，应该 1-2 次搜索搞定",
    ),
    TestCase(
        id="case_002",
        topic="HTTP 和 HTTPS 的区别",
        difficulty="easy",
        expected_tools=["search_web"],
        notes="基本概念查询，标准知识",
    ),

    # ---- medium：多角度搜索 / 该深读时深读 ----
    TestCase(
        id="case_003",
        topic="React 和 Vue 有什么区别",
        difficulty="medium",
        expected_tools=["search_web"],
        notes="对比类，应该从多个角度搜（React 特点、Vue 特点、对比）",
    ),
    TestCase(
        id="case_004",
        topic="LangChain 是什么",
        difficulty="medium",
        expected_tools=["search_web", "fetch_url"],
        notes="适合读 Wikipedia 全文，考察是否主动 fetch",
    ),
    TestCase(
        id="case_005",
        topic="2026 年最新的 AI 模型有哪些",
        difficulty="medium",
        expected_tools=["search_web"],
        notes="时事类，验证联网搜索的真实性（不能编旧知识）",
    ),

    # ---- hard：技术深度 / 复杂对比 ----
    TestCase(
        id="case_006",
        topic="LangChain 的 Tool Calling 机制是怎么实现的",
        difficulty="hard",
        expected_tools=["search_web", "fetch_url"],
        notes="技术深度，应该读官方文档或深度博客的全文",
    ),
    TestCase(
        id="case_007",
        topic="RAG 和微调，什么时候该用哪个",
        difficulty="hard",
        expected_tools=["search_web"],
        notes="复杂决策对比，需要多角度搜索综合",
    ),
    TestCase(
        id="case_008",
        topic="GLM-4 和 GPT-4 的架构区别",
        difficulty="hard",
        expected_tools=["search_web", "fetch_url"],
        notes="深度技术对比，适合读技术分析全文",
    ),

    # ---- edge：异常输入，考察优雅降级 ----
    TestCase(
        id="case_009",
        topic="qwertyuiop12345 乱码查询",
        difficulty="edge",
        expected_tools=[],
        notes="无意义输入，Agent 应该识别出无意义或搜索后诚实说没结果",
    ),
    TestCase(
        id="case_010",
        topic="XYZ Framework 这个不存在的框架是什么",
        difficulty="edge",
        expected_tools=["search_web"],
        notes="不存在的主题，搜索应该失败或无结果，Agent 要诚实降级不能编造",
    ),
]


def get_cases_by_difficulty(difficulty: str) -> List[TestCase]:
    """按难度筛选课题。"""
    return [c for c in TEST_CASES if c.difficulty == difficulty]


if __name__ == "__main__":
    print(f"=== Benchmark 课题集：共 {len(TEST_CASES)} 个 ===\n")
    for c in TEST_CASES:
        tools = ", ".join(c.expected_tools) if c.expected_tools else "(无)"
        print(f"[{c.difficulty:6}] {c.id} | {c.topic}")
        print(f"          预期工具: {tools}")
        print(f"          {c.notes}\n")

    # 统计
    print("--- 难度分布 ---")
    for d in ["easy", "medium", "hard", "edge"]:
        cnt = len(get_cases_by_difficulty(d))
        print(f"  {d:6}: {cnt}")
