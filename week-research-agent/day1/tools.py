"""
Day 1 - Tools：真正干活的 Python 函数。

【核心认知】对应笔记 Lesson 01 里的「角色 3：Python Tool」
Tool 本质就是普通 Python 函数，没有任何魔法。
- 模型（LLM）不执行 Tool
- 模型只输出"工具名 + 参数"
- 这里才是真正执行的地方

【设计原则】统一返回格式
所有 Tool 都返回 {"success": bool, "result": ...}，方便后续统一处理。
这也是 Lesson 02 笔记里强调的统一返回结构。
"""


def add(a: float, b: float) -> dict:
    """
    算加法。

    看似简单，但这是 Agent 能"算数"的本质：
    LLM 自己算不准大数/小数/复杂运算，但 Python 永远准确。
    """
    result = a + b
    return {
        "success": True,
        "result": f"{a} + {b} = {result}",
    }


def read_file(path: str) -> dict:
    """
    读本地文件内容。

    让 Agent 拥有"看本地文件"的能力。
    LLM 训练时根本没见过你电脑上的文件，必须靠 Tool 才能读到。
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "success": True,
            "result": content,
        }
    except FileNotFoundError:
        return {
            "success": False,
            "result": f"文件不存在：{path}",
        }
    except Exception as e:
        return {
            "success": False,
            "result": f"读取失败：{type(e).__name__}: {e}",
        }


# ============================================================
# 自己跑一下：理解"Tool 就是普通函数"
# ============================================================
if __name__ == "__main__":
    print("=== 直接调用 Tool（没有 LLM，纯 Python）===")
    print("add(3, 5)        →", add(3, 5))
    print("add(1.5, 2.5)    →", add(1.5, 2.5))
    print("read_file(存在)  →", read_file("../README.md")["result"][:50] + "...")
    print("read_file(不存在)→", read_file("不存在.txt"))

    print("\n【关键理解】")
    print("这些函数和 LLM 没有任何关系。")
    print("它们就是普通 Python 函数，你写了一辈子的那种。")
    print("Agent 的魔法不在这里——在「怎么让 LLM 决定调用谁、传什么参数」。")
