"""
Day 3 - Schemas：三个工具的 Schema。

【和 Day 2 的区别】
- mock_search 改名为 search_web（语义更准确：这是真实搜索了）
- description 强调"联网"和"最新信息"，让 LLM 知道什么时候该用它
"""
import json

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "add",
            "description": "计算两个数字的加法。当用户问'几加几'、需要做加法运算时使用。",
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
            "description": "读取本地文件的内容。当用户让你'读取/打开/看看某个文件'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径，例如 'README.md' 或 '../README.md'",
                    },
                },
                "required": ["path"],
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


if __name__ == "__main__":
    print("=== 三个工具的 Schema ===")
    print(json.dumps(TOOLS_SCHEMA, indent=2, ensure_ascii=False))
    print(f"\n共 {len(TOOLS_SCHEMA)} 个工具：", [t["function"]["name"] for t in TOOLS_SCHEMA])
