"""
Day 4 - Schemas：工具 schema + 结构化输出 schema。

【Day 3 的问题】
LLM 返回自然语言，下游程序用不了。比如想给答案做分类、打标签、
存数据库，自然语言很难处理。

【Day 4 的升级】
新增 research_answer schema，强制 LLM 返回结构化 JSON。
这样：
- 答案有固定字段（summary / key_points / sources）
- 下游程序能直接解析
- 适合做报告生成、数据分析

【两种 schema 的区别】
- tools schema（函数调用）：告诉 LLM 有哪些工具
- response format schema（响应格式）：告诉 LLM 答案长什么样
"""
import json

# ============================================================
# 1. 工具 schema（和 Day 3 一样）
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
            "name": "search_web",
            "description": "联网搜索最新信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                },
                "required": ["query"],
            },
        },
    },
]


# ============================================================
# 2. 响应格式 schema（Day 4 新增）
# ============================================================
# 强制 LLM 按这个结构返回 JSON，而不是自然语言。
# 智谱 GLM 支持用 response_format 参数指定。
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

    print("\n=== 响应格式 schema（Day 4 新增）===")
    print(json.dumps(RESPONSE_FORMAT, indent=2, ensure_ascii=False))
    print("\n→ 这个格式强制 LLM 返回 {summary, key_points, sources, confidence}")
    print("  下游程序可以直接 json.loads() 拿到结构化数据")
