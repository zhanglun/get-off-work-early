"""
Day 2 - Schemas：三个工具的 Tool Schema。

【和 Day 1 的区别】
新增 mock_search 的 schema，让 LLM 知道"还有搜索工具可用"。

【关键点】description 决定 LLM 什么时候选这个工具：
- add：用户要算加法时
- read_file：用户要读文件时
- mock_search：用户要"搜索/查询/查信息"时
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
            "name": "mock_search",
            "description": (
                "搜索互联网信息（模拟）。"
                "当用户问需要联网或查最新资料的问题时使用，例如'搜索...''查一下...''最近有什么...'"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，例如'2026年AI进展'",
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
