"""
工具对比：手写版 vs LangChain 版。

【学习目标】
看清楚 @tool 装饰器帮你省了什么，以及它和你手写的 schema 有什么关系。

【对比维度】
1. 工具函数（业务逻辑）：几乎一样
2. schema 定义：手写 JSON vs @tool 自动生成
3. 工具注册：手写 dict vs tools 列表
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from langchain_core.tools import tool


# ============================================================
# 对比 1：search_web
# ============================================================

# -------- 手写版（Day 2/3 写的，这里简化展示核心） --------
# common/tools.py 里：
# def search_web(query: str, count: int = 5) -> dict:
#     return {"success": True, "results": [...]}
#
# common/schemas.py 里（手写 JSON schema）：
# {
#     "type": "function",
#     "function": {
#         "name": "search_web",
#         "description": "联网搜索互联网上的最新信息...",
#         "parameters": {
#             "type": "object",
#             "properties": {
#                 "query": {"type": "string", "description": "搜索关键词"},
#             },
#             "required": ["query"],
#         },
#     },
# }
#
# 注册：TOOL_REGISTRY = {"search_web": search_web}
# 给 LLM：TOOLS_SCHEMA = [上面那坨 JSON]


# -------- LangChain 版（用 @tool 装饰器） --------
@tool
def search_web(query: str) -> str:
    """
    联网搜索互联网上的最新信息。当用户问需要联网查询的问题时使用，
    例如'搜索...''查一下最近...''2026年最新的...'。
    """
    # 业务逻辑：复用手写版的实现
    from common.tools import search_web as _search
    import json
    result = _search(query)
    return json.dumps(result, ensure_ascii=False)  # LangChain 要求返回字符串


# ============================================================
# 对比 2：query_docs（RAG 工具）
# ============================================================

# -------- 手写版 --------
# common/tools.py + common/schemas.py 手写 schema + TOOL_REGISTRY 注册
# （和 search_web 一样的三件套）

# -------- LangChain 版 --------
@tool
def query_docs(question: str) -> str:
    """
    从本地知识库检索文档。当用户问关于私有文档的问题时使用——
    例如'我们公司的报销流程''团队的代码规范'。
    这些内容互联网上搜不到，必须用本工具查本地知识库。
    """
    from common.tools import query_docs as _query
    import json
    result = _query(question)
    return json.dumps(result, ensure_ascii=False)


# ============================================================
# 对比 3：add（最简单的，对比最清晰）
# ============================================================

# -------- 手写版 --------
# def add(a: float, b: float) -> dict:
#     return {"success": True, "result": f"{a} + {b} = {a + b}"}
# + 手写 schema（10 行 JSON）
# + TOOL_REGISTRY 注册

# -------- LangChain 版 --------
@tool
def add(a: float, b: float) -> str:
    """计算两个数字的加法。当用户问'几加几'、需要做加法运算时使用。"""
    return f"{a} + {b} = {a + b}"   # 就这么简单，schema 全自动


# ============================================================
# 框架自动生成了什么（这是学习重点）
# ============================================================
def show_what_framework_generates():
    """打印 LangChain 自动生成的 schema，和手写版对比。"""
    print("=" * 60)
    print("LangChain 自动生成的 schema（对比你手写的 JSON）")
    print("=" * 60)

    for t in [add, search_web, query_docs]:
        print(f"\n--- {t.name} ---")
        print(f"name: {t.name}")              # 自动从函数名取
        print(f"description: {t.description}")  # 自动从 docstring 取
        print(f"args: {t.args_schema.model_json_schema()}")  # 自动从类型注解取
        print(f"（手写版这些都要自己写 JSON）")


# ============================================================
# 打包成 tools 列表（给 Agent 用）
# ============================================================
# 手写版：TOOLS_SCHEMA（JSON 列表）+ TOOL_REGISTRY（dict）
# LangChain 版：一个 tools 列表搞定
ALL_TOOLS = [add, search_web, query_docs]


if __name__ == "__main__":
    show_what_framework_generates()

    print("\n" + "=" * 60)
    print("工具列表（给 Agent 用）")
    print("=" * 60)
    for t in ALL_TOOLS:
        print(f"  • {t.name}: {t.description[:40]}...")
