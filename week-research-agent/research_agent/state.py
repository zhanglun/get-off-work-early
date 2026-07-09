"""
ResearchState：研究助手的专属状态（Day 5）。

【继承链】
common.AgentState（Day 3 基类）
  → structured_answer          （Day 4 扩展）
    → topic / findings / report （Day 5 扩展）

【Day 5 新增字段说明】
- topic:    研究课题（用户输入的原始问题）
- findings: 阶段 A 收集到的研究素材（每轮搜索的精华，拼成文本喂给阶段 B）
- report:   阶段 B 生成的最终结构化报告（dict）

Day 4 的 structured_answer 字段保留但不用——Day 5 用 report 字段替代，
语义更清晰（"研究报告"比"结构化答案"更准确）。
"""
from dataclasses import dataclass, field
from typing import Any

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common.state import AgentState as _BaseAgentState, ToolCallRecord


@dataclass
class ResearchState(_BaseAgentState):
    """
    Research Agent 的完整状态。

    继承 common.AgentState 的所有字段（messages/steps/tool_history/...），
    新增研究专属字段。
    """
    # ---- Day 5 研究专属 ----
    topic: str = ""                              # 研究课题
    findings: str = ""                           # 阶段 A 收集的素材（文本汇总）
    report: dict = field(default_factory=dict)   # 阶段 B 生成的结构化报告

    def research_summary(self) -> str:
        """生成研究专用的运行摘要（比 summary() 多报告研究维度）。"""
        base = self.summary()
        extra = [
            "",
            "=== 研究维度 ===",
            f"课题: {self.topic or '(未设置)'}",
            f"素材长度: {len(self.findings)} 字符",
            f"报告生成: {'✓ 已生成' if self.report else '✗ 未生成'}",
        ]
        # 统计搜索次数和关键词
        search_calls = [tc for tc in self.tool_history if tc.tool_name == "search_web"]
        if search_calls:
            extra.append(f"搜索次数: {len(search_calls)}")
            extra.append("搜索关键词:")
            for i, tc in enumerate(search_calls, 1):
                q = tc.arguments.get("query", "?")
                mark = "✓" if tc.success else "✗"
                extra.append(f"  {i}. {mark} {q}")
        return "\n".join([base] + extra)


if __name__ == "__main__":
    print("=== ResearchState 字段演示 ===\n")
    s = ResearchState(max_steps=8, topic="2026 AI Agent 框架")
    print("所有字段:", [f.name for f in ResearchState.__dataclass_fields__.values()])
    print("\n=== research_summary 演示 ===")
    s.add_tool_call(ToolCallRecord(
        step=1, tool_name="search_web",
        arguments={"query": "AI Agent framework 2026"},
        result={"success": True, "count": 5}, elapsed=2.1, success=True,
    ))
    s.findings = "（模拟素材）LangChain、AutoGen、CrewAI 是主流框架..."
    s.status = "finished"
    print(s.research_summary())
