# pyright: reportMissingImports=false
# 本文件由项目 .venv 执行；当前全局 LSP 未绑定该虚拟环境，故关闭其误报的第三方导入检查。
"""Lesson 01：用 LangGraph 复刻最小工具调用循环。

对照手写版 day3/agent.py：
  while message.tool_calls:
      执行工具 → 追加 Observation → 再问 LLM

LangGraph 版把这个隐式 while 拆成可见图：
  START → model → [有工具调用?] → tools → model
                    └─[没有]──────→ END

运行：
  python -m langgraph_version.lesson01_minimal_graph
"""
from __future__ import annotations

import json
import os
import sys
from typing import Annotated, TypedDict, cast

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langchain_community.chat_models import ChatZhipuAI
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from config import Config


@tool
def add(a: float, b: float) -> str:
    """计算两个数字的加法。用户需要计算两个数相加时使用。"""
    return json.dumps(
        {"success": True, "result": f"{a} + {b} = {a + b}"},
        ensure_ascii=False,
    )


TOOLS = [add]


class MinimalGraphState(TypedDict):
    """图的共享状态（白板）。

    messages 使用 add_messages reducer：Node 每次返回的新消息会追加到历史；
    这就对应手写版的 state.messages.append(...)。
    """

    messages: Annotated[list[BaseMessage], add_messages]
    model_calls: int


def create_llm() -> ChatZhipuAI:
    """创建与现有 LangChain 对照版相同的模型适配器。"""
    Config.check()
    return ChatZhipuAI(
        model=Config.MODEL,
        temperature=Config.TEMPERATURE,
        api_key=Config.API_KEY,
    )


def build_graph():
    """构建并编译最小 Graph。

    Node 做工作；Edge 决定下一步。
    model Node：调用 LLM。
    tools Node：由预置 ToolNode 执行工具并生成 ToolMessage。
    """
    llm_with_tools = create_llm().bind_tools(TOOLS)

    def call_model(state: MinimalGraphState) -> dict:
        """model 节点：LLM 决定调用工具还是直接回答。"""
        response = llm_with_tools.invoke(state["messages"])
        return {
            "messages": [response],
            "model_calls": state.get("model_calls", 0) + 1,
        }

    def route_after_model(state: MinimalGraphState) -> str:
        """条件边：最后一条 AIMessage 有 tool_calls 则去 tools，否则结束。"""
        last_message = state["messages"][-1]
        if isinstance(last_message, AIMessage) and last_message.tool_calls:
            return "tools"
        return "end"

    graph = StateGraph(MinimalGraphState)
    graph.add_node("model", call_model)
    graph.add_node("tools", ToolNode(TOOLS))
    graph.add_edge(START, "model")
    graph.add_conditional_edges(
        "model",
        route_after_model,
        {"tools": "tools", "end": END},
    )
    graph.add_edge("tools", "model")
    return graph.compile()


def print_trace(result: MinimalGraphState) -> None:
    """把图状态还原成可读 trace，方便与手写 while 循环对照。"""
    print("\n=== LangGraph 运行轨迹 ===")
    for index, message in enumerate(result["messages"], 1):
        kind = type(message).__name__
        content = str(message.content).replace("\n", " ")
        if isinstance(message, AIMessage) and message.tool_calls:
            calls = [f"{call['name']}({call['args']})" for call in message.tool_calls]
            print(f"{index}. {kind}: 工具调用 → {', '.join(calls)}")
        elif kind == "ToolMessage":
            print(f"{index}. {kind}: Observation → {content}")
        else:
            print(f"{index}. {kind}: {content}")
    print(f"模型调用次数：{result['model_calls']}")


def main() -> None:
    graph = build_graph()
    print("=== Lesson 01：最小 LangGraph 工具循环 ===")
    print("图：START → model → tools → model → END\n")

    initial_state: MinimalGraphState = {
        "messages": [
            SystemMessage(content="你是计算助手。遇到加法必须调用 add 工具，拿到结果后用中文简洁回答。"),
            HumanMessage(content="12.5 加 7.25 等于多少？"),
        ],
        "model_calls": 0,
    }

    # recursion_limit 是框架级循环保护；不同于业务侧 max_steps。
    result = cast(
        MinimalGraphState,
        graph.invoke(initial_state, config={"recursion_limit": 10}),
    )
    print_trace(result)

    final_message = result["messages"][-1]
    print(f"\n最终回答：{final_message.content}")


if __name__ == "__main__":
    main()
