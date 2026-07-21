"""
Agent 对比：手写版 vs LangChain 版。

【学习目标】
看清楚 AgentExecutor 帮你封装了什么——
就是你 Day 3 写的那个 while message.tool_calls 循环。

【对比】
手写版（researcher.py 约 100 行）：
  1. 拼 messages
  2. client.chat.completions.create
  3. while message.tool_calls:
       执行工具
       回传结果
       再调 LLM
  4. max_steps 防死循环
  5. state 记录

LangChain 版（约 15 行）：
  create_agent(llm, tools) → invoke → 完了
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from langchain_community.chat_models import ChatZhipuAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_version.tools import ALL_TOOLS


def create_agent_llm():
    """
    创建 LangChain 版的 LLM 客户端。

    对比手写版：
      client = ZhipuAI(api_key=Config.API_KEY)
      response = client.chat.completions.create(model=Config.MODEL, messages=[...])

    LangChain 版：
      llm = ChatZhipuAI(model=Config.MODEL)
      response = llm.invoke([HumanMessage(content="...")])

    区别：LangChain 把"创建 client + 调用 + 解析"统一成 llm.invoke()
    """
    Config.check()
    return ChatZhipuAI(
        model=Config.MODEL,
        temperature=Config.TEMPERATURE,
        api_key=Config.API_KEY,
    )


def run_langchain_agent(user_input: str, verbose: bool = True) -> str:
    """
    LangChain 版 Agent。

    对比手写版的 run_research（researcher.py 的 while 循环，约 100 行）：
      while message.tool_calls:
          for tool_call in message.tool_calls:
              result = TOOL_REGISTRY[fn_name](**args)
              state.messages.append(...)
          response = client.chat.completions.create(...)
          message = response.choices[0].message

    LangChain 版用 create_agent 一行搞定：
      传入 llm + tools → 自动跑 Loop → 返回结果
    """
    llm = create_agent_llm()

    # 绑定工具到 LLM（让 LLM 知道有哪些工具可用）
    # 对比手写版：client.chat.completions.create(tools=TOOLS_SCHEMA)
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    messages = [
        SystemMessage(content="你是一个研究助手，能联网搜索和查本地知识库。根据问题选择合适的工具。"),
        HumanMessage(content=user_input),
    ]

    # ===== 这就是手写版的 while 循环 =====
    # LangChain 的 LLM 自带 tool_calls 解析，但仍需手动循环（和手写版结构一样）
    # 真正一行搞定的是 create_tool_calling_agent + AgentExecutor（见下方注释）
    max_steps = 8
    for step in range(max_steps):
        response = llm_with_tools.invoke(messages)
        messages.append(response)

        if verbose:
            print(f"\n--- 第 {step + 1} 步 ---")

        # 如果 LLM 没要调工具，就是最终答案
        if not response.tool_calls:
            if verbose:
                print(f"💬 最终答案：{response.content[:200]}")
            return response.content

        # 执行工具调用（对比手写版的 for tool_call in message.tool_calls）
        for tc in response.tool_calls:
            tool_name = tc["name"]
            tool_args = tc["args"]
            if verbose:
                print(f"🔧 调用工具：{tool_name}({tool_args})")

            # 找到工具并执行
            tool_fn = {t.name: t for t in ALL_TOOLS}.get(tool_name)
            if tool_fn:
                result = tool_fn.invoke(tool_args)
            else:
                result = f"未知工具：{tool_name}"

            if verbose:
                print(f"   → 结果：{str(result)[:100]}")

            # 回传工具结果给 LLM
            from langchain_core.messages import ToolMessage
            messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))

    return "达到最大步数"


def run_with_agent_executor(user_input: str) -> str:
    """
    用 AgentExecutor 版（真正的"一行创建 Agent"）。

    这是 LangChain 最简洁的写法——create_tool_calling_agent + AgentExecutor。

    对比手写版：
      手写 while 循环 + TOOL_REGISTRY + state.can_continue() = 约 100 行
      AgentExecutor = 5 行

    AgentExecutor 帮你封装了：
      - while 循环（你的 while message.tool_calls）
      - 工具调用（你的 TOOL_REGISTRY[fn_name](**args)）
      - max_iterations（你的 state.can_continue / max_steps）
      - 错误处理（你的 try/except）
      - 中间步骤记录（你的 ToolCallRecord）
    """
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate

    llm = create_agent_llm()

    # prompt 模板（对比手写版的 System Prompt）
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个研究助手，能联网搜索和查本地知识库。根据问题选择合适的工具。"),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),  # ← 工具调用的中间记录
    ])

    # 创建 Agent（绑定 llm + tools + prompt）
    agent = create_tool_calling_agent(llm, ALL_TOOLS, prompt)

    # 创建 Executor（封装了 while 循环）
    # max_iterations = 你的 max_steps
    executor = AgentExecutor(
        agent=agent,
        tools=ALL_TOOLS,
        max_iterations=8,     # 对比你的 max_steps=8
        verbose=True,         # 打印中间步骤
        handle_parsing_errors=True,
    )

    # 一行运行（内部自动跑 while 循环）
    result = executor.invoke({"input": user_input})
    return result["output"]


if __name__ == "__main__":
    print("=" * 60)
    print(" LangChain 版 Agent 对比测试")
    print(" 对比你的手写版（researcher.py）")
    print("=" * 60)

    while True:
        try:
            question = input("\n你（输入 quit 退出）> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break
        if not question or question.lower() in ("quit", "exit", "q"):
            break

        print("\n【方式 1：手写循环版（对照你的 Day 3）】")
        print("-" * 40)
        run_langchain_agent(question)

        # 方式 2 注释掉（避免重复调用浪费 token）
        # print("\n【方式 2：AgentExecutor 版（最简）】")
        # run_with_agent_executor(question)
