"""
Day 2 - Tools：三个工具（凑齐 Lesson 01 的 Calculator + Read File + Mock Search）。

【和 Day 1 的区别】
新增 mock_search——一个返回假数据的"搜索"函数。
为什么用 Mock？因为 Lesson 01-02 的重点是"理解 Tool Calling 机制"，
而不是"接入真实搜索"（那是 Lesson 03 / Day 3 的事）。
先用 Mock 跑通多工具循环，Day 3 再换成真实的。

【设计原则】统一返回格式 {"success": bool, "result": ...} 保持不变。
"""


def add(a: float, b: float) -> dict:
    """计算两个数字的加法。"""
    return {
        "success": True,
        "result": f"{a} + {b} = {a + b}",
    }


def read_file(path: str) -> dict:
    """读取本地文件内容。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"success": True, "result": content}
    except FileNotFoundError:
        return {"success": False, "result": f"文件不存在：{path}"}
    except Exception as e:
        return {"success": False, "result": f"读取失败：{type(e).__name__}: {e}"}


def mock_search(query: str) -> dict:
    """
    假的搜索工具：返回模拟的搜索结果。

    【为什么用 Mock】
    1. 不依赖任何外部 API（不需要 key，不会失败）
    2. 永远返回固定结构，方便观察 LLM 怎么"解读搜索结果"
    3. Day 3 会把这个函数替换成真实的智谱 web_search，但函数签名不变
       —— 这就是 Tool 的好处：实现可以换，接口不变，Agent 代码不用改

    真实搜索长什么样，Day 3 你会看到；今天先理解"循环多步"的机制。
    """
    fake_results = [
        {"title": f"关于「{query}」的模拟结果 1", "snippet": f"这是和「{query}」相关的第一条模拟信息。"},
        {"title": f"关于「{query}」的模拟结果 2", "snippet": f"这是和「{query}」相关的第二条模拟信息。"},
        {"title": f"关于「{query}」的模拟结果 3", "snippet": f"这是和「{query}」相关的第三条模拟信息。"},
    ]
    return {
        "success": True,
        "result": fake_results,
        "note": "（这是 Mock 数据，Day 3 会替换成真实 web_search）",
    }


if __name__ == "__main__":
    print("=== 验证三个工具 ===")
    print("add(3, 5)         →", add(3, 5))
    print("read_file(README) →", read_file("../README.md")["result"][:40] + "...")
    print("mock_search(AI)   →", mock_search("AI"))
