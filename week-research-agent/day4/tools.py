"""
Day 4 - 带超时 + 重试的工具。

【Day 3 的问题】
search_web 虽然加了重试，但是：
- 没有超时保护（万一某次卡住 30 秒，整个 Agent 就卡死）
- 重试逻辑写在工具里，每个工具都要重复写

【Day 4 的升级】
1. 写一个通用 retry_with_timeout 装饰器，所有工具都能用
2. search_web 加超时（单次最多 10 秒）
3. 工具失败时不影响 Agent 主流程
"""
import os
import sys
import time
import functools
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import Config


# ============================================================
# 通用装饰器：超时 + 重试
# ============================================================
# 这个装饰器是 Day 4 的精华——一次写好，所有工具都能用。
# 原理：
# - 用线程池给函数套一个"时间限制"（超时）
# - 失败时自动重试 N 次
# - 全部失败才返回错误
def retry_with_timeout(timeout: float = 10.0, retries: int = 3):
    """
    装饰器：给任何函数加超时 + 重试。

    用法：
        @retry_with_timeout(timeout=10, retries=3)
        def search_web(query): ...

    含义：search_web 单次最多跑 10 秒，失败重试最多 3 次。
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(1, retries + 1):
                try:
                    # 用线程池实现超时
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future = executor.submit(func, *args, **kwargs)
                        result = future.result(timeout=timeout)
                    return result  # 成功，直接返回
                except FuturesTimeout:
                    last_error = TimeoutError(f"超时（{timeout}s）")
                except Exception as e:
                    last_error = e
                # 失败了，继续下一次重试
            # 全部重试都失败
            return {
                "success": False,
                "result": f"工具 {func.__name__} 重试 {retries} 次仍失败：{type(last_error).__name__}: {last_error}",
                "attempts": retries,
            }
        return wrapper
    return decorator


# ============================================================
# 工具 1：add（加法，本地操作，不需要重试/超时）
# ============================================================
def add(a: float, b: float) -> dict:
    """计算两个数字的加法。"""
    return {"success": True, "result": f"{a} + {b} = {a + b}"}


# ============================================================
# 工具 2：read_file（读文件，本地操作）
# ============================================================
def read_file(path: str) -> dict:
    """读取本地文件内容。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {"success": True, "result": f.read()}
    except FileNotFoundError:
        return {"success": False, "result": f"文件不存在：{path}"}
    except IsADirectoryError:
        # 明确告诉 LLM：这是目录，请改用 list_dir
        # 这样 LLM 收到错误后能自主切换到正确的工具
        return {"success": False, "result": f"路径是目录，不是文件：{path}（请改用 list_dir 工具）"}
    except Exception as e:
        return {"success": False, "result": f"读取失败：{type(e).__name__}: {e}"}


# ============================================================
# 工具 2.5：list_dir（列目录，本地操作）
# ============================================================
def list_dir(path: str = ".") -> dict:
    """
    列出目录下的文件和子目录。

    用 os.scandir 比 os.listdir 更高效，且能拿到「是文件还是目录」的信息。
    返回结构化列表，方便 LLM 直接总结。
    """
    try:
        import os
        if not os.path.exists(path):
            return {"success": False, "result": f"目录不存在：{path}"}
        if not os.path.isdir(path):
            return {"success": False, "result": f"路径不是目录：{path}（请改用 read_file 工具）"}

        entries = []
        with os.scandir(path) as it:
            # 按名字排序，输出稳定
            for entry in sorted(it, key=lambda e: e.name):
                entries.append({
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else None,
                })

        return {
            "success": True,
            "path": path,
            "count": len(entries),
            "entries": entries,
        }
    except Exception as e:
        return {"success": False, "result": f"列目录失败：{type(e).__name__}: {e}"}


# ============================================================
# 工具 3：search_web（联网搜索，需要重试 + 超时）
# ============================================================
@retry_with_timeout(timeout=10.0, retries=3)   # ← 一行装饰器，搞定超时+重试
def search_web(query: str, count: int = 5) -> dict:
    """联网搜索（DuckDuckGo）。"""
    from ddgs import DDGS

    results = []
    ddgs = DDGS()
    for r in ddgs.text(query, max_results=count):
        results.append({
            "title": r.get("title", ""),
            "link": r.get("href", ""),
            "content": r.get("body", "")[:300],
            "media": "DuckDuckGo",
        })

    if not results:
        return {"success": False, "result": f"搜索「{query}」没有找到结果"}

    return {
        "success": True,
        "query": query,
        "count": len(results),
        "results": results,
    }


# ============================================================
# 演示：装饰器的效果
# ============================================================
if __name__ == "__main__":
    print("=== 测试 1：正常调用（重试/超时不会触发）===")
    print(add(3, 5))

    print("\n=== 测试 2：搜索（带超时+重试保护）===")
    r = search_web("Python tutorial", count=2)
    print(f"success={r['success']}, 结果数={r.get('count', 0)}")

    print("\n=== 测试 3：演示超时保护 ===")
    @retry_with_timeout(timeout=0.1, retries=2)  # 故意设超短超时
    def slow_function():
        time.sleep(1)  # 睡 1 秒，肯定超时
        return {"success": True, "result": "不该到这里"}

    r = slow_function()
    print(f"超时结果：{r}")
    print("→ 装饰器在 0.1 秒后判定超时，重试 2 次都超时，优雅返回错误而非崩溃")
