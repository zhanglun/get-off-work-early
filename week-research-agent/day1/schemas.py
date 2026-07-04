"""
Day 1 - Schemas：Tool Schema（给 LLM 看的"工具说明书"）。

【核心认知】对应笔记 Lesson 01 里的「角色 2：Tool Schema」
Schema 的作用是告诉 LLM：
  - 你有哪些工具可以用
  - 每个工具是干嘛的（description 决定 LLM 什么时候选它）
  - 调用每个工具需要哪些参数（parameters 用 JSON Schema 描述）

【关键对比 - 笔记 Lesson 02 的重点】
| 名称          | 面向对象 | 作用              |
|---------------|----------|-------------------|
| Tool Schema   | LLM      | 告诉模型有哪些 Tool |
| Tool Registry | Python   | 找到真正的函数      |

本文件是前者（给 LLM 看）。
tools.py 里的函数是后者（给 Python 执行）。
两者通过「函数名」对应起来。
"""
import json

# 智谱 SDK 要求的格式：tools 是一个 list，每项是 {"type": "function", "function": {...}}
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            # name 必须和 tools.py 里的函数名一致！这是连接两端的"钥匙"
            "name": "add",
            # description 是 LLM 决定"要不要用这个工具"的关键依据
            # 写得越清楚，LLM 越知道什么时候该用它
            "description": "计算两个数字的加法。当用户问'几加几'、需要算加法时使用。",
            # parameters 用 JSON Schema 描述，告诉 LLM 该传什么参数
            "parameters": {
                "type": "object",
                "properties": {
                    "a": {
                        "type": "number",
                        "description": "第一个加数",
                    },
                    "b": {
                        "type": "number",
                        "description": "第二个加数",
                    },
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
                        "description": "文件的相对或绝对路径，例如 'README.md' 或 '/tmp/a.txt'",
                    },
                },
                "required": ["path"],
            },
        },
    },
]


# ============================================================
# 自己跑一下：看看给 LLM 的"说明书"长什么样
# ============================================================
if __name__ == "__main__":
    print("=== 发给 LLM 的 Tool Schema ===")
    print(json.dumps(TOOLS_SCHEMA, indent=2, ensure_ascii=False))

    print("\n【关键理解】")
    print("1. description 写得好 = LLM 选得准。模型只看 description 决定用哪个工具。")
    print("2. parameters 必须是标准 JSON Schema，描述参数类型和含义。")
    print("3. name 字段是和 tools.py 函数名对应的钥匙——不能写错。")
