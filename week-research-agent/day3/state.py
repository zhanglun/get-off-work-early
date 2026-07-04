"""
Day 3 - State：Agent 的状态管理。

【为什么需要 State？】
Day 2 的 Agent 把所有状态（messages、步数）散在函数局部变量里，跑完就没了。
Day 3 把状态抽成一个类，好处：
1. 可追溯：能完整看到"Agent 每一步干了什么"
2. 可调试：出问题时能查状态定位
3. 可持久化：后续可以存数据库/存文件（Lesson 05 Memory 的基础）
4. 可控：max_steps、停止原因等都记录下来

【State 里放什么】
- messages:    和 LLM 的完整对话历史（核心）
- steps:       已经循环了多少步
- tool_history: 每次工具调用的记录（函数名、参数、结果、耗时）
- status:      当前状态（running / finished / max_steps_reached / error）
- final_answer: 最终答案
"""
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCallRecord:
    """记录一次工具调用（用于事后追溯）。"""
    step: int                         # 第几步
    tool_name: str                    # 调了哪个工具
    arguments: dict                   # 传了什么参数
    result: Any = None                # 返回了什么
    elapsed: float = 0.0              # 耗时（秒）
    success: bool = True              # 成功与否

    def __repr__(self):
        return f"[step {self.step}] {self.tool_name}({self.arguments}) → {str(self.result)[:60]}"


@dataclass
class AgentState:
    """
    Agent 的完整状态快照。

    用 @dataclass 自动生成 __init__/__repr__，省得手写。
    """
    # ---- 核心对话状态 ----
    messages: list = field(default_factory=list)      # 和 LLM 的对话历史
    steps: int = 0                                    # 已执行的循环步数
    tool_history: list = field(default_factory=list)  # 工具调用历史

    # ---- 运行结果 ----
    status: str = "running"           # running / finished / max_steps_reached / error
    final_answer: str = ""            # 最终答案
    error: str = ""                   # 如果出错，记录错误信息

    # ---- 边界控制 ----
    max_steps: int = 10               # 最大步数，防止死循环
    started_at: float = field(default_factory=time.time)  # 开始时间

    def can_continue(self) -> bool:
        """还能不能继续循环？超过 max_steps 就停。"""
        return self.steps < self.max_steps

    def add_tool_call(self, record: ToolCallRecord):
        """记录一次工具调用。"""
        self.tool_history.append(record)

    def summary(self) -> str:
        """生成运行摘要（可读性强，用于日志和调试）。"""
        elapsed = time.time() - self.started_at
        lines = [
            f"=== Agent 运行摘要 ===",
            f"状态: {self.status}",
            f"总步数: {self.steps} (上限 {self.max_steps})",
            f"工具调用次数: {len(self.tool_history)}",
            f"总耗时: {elapsed:.2f}s",
            f"消息条数: {len(self.messages)}",
        ]
        if self.tool_history:
            lines.append("工具调用明细:")
            for tc in self.tool_history:
                mark = "✓" if tc.success else "✗"
                lines.append(f"  {mark} {tc}")
        return "\n".join(lines)


# ============================================================
# 自己跑一下：理解 State 的作用
# ============================================================
if __name__ == "__main__":
    print("=== 演示：AgentState 怎么用 ===\n")

    state = AgentState(max_steps=5)

    # 模拟加一些消息
    state.messages.append({"role": "user", "content": "3 + 5 = ?"})
    state.messages.append({"role": "assistant", "content": "3 + 5 = 8"})

    # 模拟一次工具调用记录
    state.add_tool_call(ToolCallRecord(
        step=1, tool_name="add", arguments={"a": 3, "b": 5},
        result="8", elapsed=0.001, success=True,
    ))
    state.steps = 1
    state.status = "finished"
    state.final_answer = "3 + 5 = 8"

    print(state.summary())

    print("\n=== 验证 max_steps 防死循环 ===")
    state2 = AgentState(max_steps=3)
    print(f"初始: steps={state2.steps}, can_continue={state2.can_continue()}")
    state2.steps = 3
    print(f"3步后: steps={state2.steps}, can_continue={state2.can_continue()}  ← 超过上限，停止")
