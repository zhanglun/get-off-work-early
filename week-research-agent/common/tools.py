"""
公共工具集：所有 Day 共用的 Tool 实现 + 通用装饰器。

【这里放什么】
- @retry_with_timeout 通用装饰器（Day 4 的精华，一次写好所有工具可用）
- 四个工具：add / read_file / list_dir / search_web
- 所有工具都遵循统一接口：(args...) -> dict，dict 里必有 success 字段

【设计原则】
Tool 就是普通函数。函数签名是"接口"，内部实现可换。
Day 5 的 Research Agent 直接 from common.tools import search_web，不用重写。
"""
import os
import time
import functools
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout


# ============================================================
# 通用装饰器：超时 + 重试（Day 4 精华，所有工具可复用）
# ============================================================
def retry_with_timeout(timeout: float = 10.0, retries: int = 3):
    """
    装饰器：给任何函数加超时 + 重试。

    用法：
        @retry_with_timeout(timeout=10, retries=3)
        def search_web(query): ...

    原理：
    - 用线程池给函数套一个"时间限制"（超时）
    - 失败时自动重试 N 次
    - 全部失败才返回错误 dict（不抛异常，让 Agent 能继续）
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(1, retries + 1):
                try:
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future = executor.submit(func, *args, **kwargs)
                        result = future.result(timeout=timeout)
                    return result
                except FuturesTimeout:
                    last_error = TimeoutError(f"超时（{timeout}s）")
                except Exception as e:
                    last_error = e
            return {
                "success": False,
                "result": f"工具 {func.__name__} 重试 {retries} 次仍失败：{type(last_error).__name__}: {last_error}",
                "attempts": retries,
            }
        return wrapper
    return decorator


# ============================================================
# 工具 1：add（加法，本地操作）
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
        return {"success": False, "result": f"路径是目录，不是文件：{path}（请改用 list_dir 工具）"}
    except Exception as e:
        return {"success": False, "result": f"读取失败：{type(e).__name__}: {e}"}


# ============================================================
# 工具 3：list_dir（列目录，本地操作，Day 4 新增）
# ============================================================
def list_dir(path: str = ".") -> dict:
    """
    列出目录下的文件和子目录。

    用 os.scandir 比 os.listdir 更高效，且能拿到「是文件还是目录」的信息。
    """
    try:
        if not os.path.exists(path):
            return {"success": False, "result": f"目录不存在：{path}"}
        if not os.path.isdir(path):
            return {"success": False, "result": f"路径不是目录：{path}（请改用 read_file 工具）"}

        entries = []
        with os.scandir(path) as it:
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
# 工具 4：search_web（联网搜索，需要重试 + 超时）
# ============================================================
@retry_with_timeout(timeout=10.0, retries=3)
def search_web(query: str, count: int = 5) -> dict:
    """联网搜索（DuckDuckGo，免费无需 key）。"""
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
