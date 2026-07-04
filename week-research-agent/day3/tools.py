"""
Day 3 - Tools：真实联网搜索替换 Mock。

【Day 3 核心升级】
Day 2 的 mock_search 返回假数据，今天换成真实的 DuckDuckGo 搜索。
为什么用 DuckDuckGo？免费、无需 API Key、无需充值，最适合学习。

【关键设计 - 体现"Tool 就是普通函数"的理念】
注意：search_web 的函数签名和 Day 2 的 mock_search 完全一样！(query: str) -> dict
但内部实现从"返回假数据"换成了"真实联网搜索"。
Agent 的其他代码（schema、registry、loop）一行都不用改！
这正是 Tool 抽象的威力：实现可换，接口不变。
"""
import os

# ============================================================
# 原有的两个工具（保持不变）
# ============================================================
def add(a: float, b: float) -> dict:
    """计算两个数字的加法。"""
    return {"success": True, "result": f"{a} + {b} = {a + b}"}


def read_file(path: str) -> dict:
    """读取本地文件内容。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {"success": True, "result": f.read()}
    except FileNotFoundError:
        return {"success": False, "result": f"文件不存在：{path}"}
    except Exception as e:
        return {"success": False, "result": f"读取失败：{type(e).__name__}: {e}"}


# ============================================================
# 新：真实联网搜索（用 DuckDuckGo，替换 mock_search）
# ============================================================
def search_web(query: str, count: int = 5) -> dict:
    """
    调用 DuckDuckGo 进行真实联网搜索。

    免费、无需 API Key。返回和 Day 2 mock_search 完全相同的结构，
    所以 Agent 的其他代码不用改一行。

    （如果你后续充值了智谱，可以把这里的实现换成智谱 web_search，
     函数签名不变，Agent 代码不用动——这就是 Tool 抽象的价值）
    """
    try:
        # 延迟导入：只用这个工具时才加载，加快启动
        from ddgs import DDGS

        results = []
        # 重试 3 次（DuckDuckGo 偶尔会因为网络/代理报错）
        last_error = None
        for attempt in range(3):
            try:
                ddgs = DDGS()
                # 用英文关键词通常更稳定（DuckDuckGo 中文支持一般）
                for r in ddgs.text(query, max_results=count):
                    results.append({
                        "title": r.get("title", ""),
                        "link": r.get("href", ""),
                        "content": r.get("body", "")[:300],
                        "media": "DuckDuckGo",
                    })
                if results:
                    break
            except Exception as e:
                last_error = e
                continue

        if not results:
            if last_error:
                return {"success": False, "result": f"搜索失败（重试3次）：{type(last_error).__name__}: {last_error}"}
            return {"success": False, "result": f"搜索「{query}」没有找到结果"}

        return {
            "success": True,
            "query": query,
            "count": len(results),
            "results": results,
        }
    except Exception as e:
        return {"success": False, "result": f"搜索失败：{type(e).__name__}: {e}"}


# ============================================================
# 自己跑一下：看真实搜索结果长什么样
# ============================================================
if __name__ == "__main__":
    import json
    print("=== 测试真实联网搜索（DuckDuckGo）===\n")
    result = search_web("AI Agent framework 2026", count=3)
    print(json.dumps(result, indent=2, ensure_ascii=False)[:1000])

