"""
公共 Schema：Tool Schema + Response Format。

【两种 schema 的区别】
- TOOLS_SCHEMA（函数调用）：告诉 LLM 有哪些工具可用
- RESPONSE_FORMAT（响应格式）：告诉 LLM 最终答案长什么样（Day 4 引入）

Day 5 的两步法：
- 阶段 A（researcher）只用 TOOLS_SCHEMA
- 阶段 B（reporter）只用 RESPONSE_FORMAT
两者分开，避免 Day 4 踩坑 3 的"结构化输出和工具调用互相干扰"。
"""
import json

# ============================================================
# 1. 工具 schema（四个工具）
# ============================================================
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "add",
            "description": "计算两个数字的加法。",
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {"type": "number", "description": "第一个加数"},
                    "b": {"type": "number", "description": "第二个加数"},
                },
                "required": ["a", "b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文件的内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": (
                "列出目录下的文件和子目录（不含文件内容）。"
                "当用户问'当前目录有什么''列一下文件夹''查看目录结构'时使用。"
                "注意：如果要读文件内容，请用 read_file；如果要看目录里有什么，用本工具。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "目录路径，默认 '.' 表示当前目录，例如 '.' 或 '..' 或 'day4'",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": (
                "抓取指定网页的完整正文内容。当某个搜索结果看起来很相关、"
                "需要深入了解详情时使用——比如 search_web 找到了几篇文章，"
                "你想读其中一篇的全文而不是摘要。"
                "注意：先用 search_web 找链接，再用本工具读全文。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要抓取的网页链接（通常来自 search_web 结果中的 link 字段）",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "联网搜索互联网上的最新信息。当用户问需要联网查询的问题时使用，例如"
                "'搜索...''查一下最近...''2026年最新的...'。适合查新闻、技术动态、实时数据。"
                "返回多个结果的摘要（每条约 300 字）。如果某条结果很相关想读全文，请用 fetch_url。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，建议用具体的关键词，例如 'AI Agent framework 2026'",
                    },
                },
                "required": ["query"],
            },
        },
    },
]


# ============================================================
# 2. 响应格式 schema（Day 4 引入，Day 5 reporter 用）
# ============================================================
# 强制 LLM 按这个结构返回 JSON，而不是自然语言。
RESPONSE_FORMAT = {
    "type": "json_object",
    "schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "对问题的简要总结性回答（1-3 句话）",
            },
            "key_points": {
                "type": "array",
                "items": {"type": "string"},
                "description": "关键要点列表（每个要点一句话）",
            },
            "sources": {
                "type": "array",
                "items": {"type": "string"},
                "description": "信息来源（如果有搜索结果，列出链接或标题）",
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
                "description": "对答案的置信度",
            },
        },
        "required": ["summary", "key_points", "confidence"],
    },
}


if __name__ == "__main__":
    print("=== 工具 schema ===")
    print(f"共 {len(TOOLS_SCHEMA)} 个工具：", [t["function"]["name"] for t in TOOLS_SCHEMA])
    print("\n=== 响应格式 schema ===")
    print(json.dumps(RESPONSE_FORMAT, indent=2, ensure_ascii=False))
