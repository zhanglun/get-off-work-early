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
# 工具 4：fetch_url（抓取网页正文，Day 5 新增）
# ============================================================
# 和 search_web 的区别：
# - search_web 返回多个结果的「摘要」（每条 300 字，广度优先）
# - fetch_url 返回单个网页的「完整正文」（几千字，深度优先）
# 配合使用：先 search_web 找到相关链接，再 fetch_url 读全文。
@retry_with_timeout(timeout=15.0, retries=2)
def fetch_url(url: str, max_length: int = 5000) -> dict:
    """
    抓取指定 URL 的网页正文。

    用 readability-lxml 自动提取正文（去掉导航/广告/侧边栏）。
    返回纯文本，方便 LLM 直接阅读。

    参数：
        url:        网页链接（通常来自 search_web 的结果）
        max_length: 最多返回多少字符（避免超长网页撑爆上下文）
    """
    try:
        # 延迟导入，加快启动
        import urllib.request
        from readability import Document

        req = urllib.request.Request(
            url,
            headers={
                # 伪装成浏览器，否则很多网站会拒绝
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            # 拿到 HTML 字节流，解码成文本
            html_bytes = resp.read()
            # 自动探测编码（中文网站常用 gbk 或 utf-8）
            html = _decode_html(html_bytes, resp.headers.get("Content-Type", ""))

        # readability 提取正文
        doc = Document(html)
        title = doc.short_title() or url
        # summary() 返回正文 HTML，转成纯文本
        content_html = doc.summary()
        text = _html_to_text(content_html)

        # 清理多余空白
        text = " ".join(text.split())

        # 截断到 max_length，避免撑爆 LLM 上下文
        truncated = False
        if len(text) > max_length:
            text = text[:max_length]
            truncated = True

        return {
            "success": True,
            "url": url,
            "title": title,
            "content": text,
            "length": len(text),
            "truncated": truncated,
        }
    except Exception as e:
        return {"success": False, "result": f"抓取失败：{type(e).__name__}: {e}"}


def _decode_html(html_bytes: bytes, content_type: str) -> str:
    """根据 HTTP 头或 meta 标签探测编码，解码 HTML。"""
    # 先从 Content-Type 头找编码
    encoding = "utf-8"
    if "charset=" in content_type.lower():
        encoding = content_type.lower().split("charset=")[-1].split(";")[0].strip()

    try:
        return html_bytes.decode(encoding, errors="replace")
    except (LookupError, UnicodeDecodeError):
        # 编码名不合法，退回 utf-8
        return html_bytes.decode("utf-8", errors="replace")


def _html_to_text(html: str) -> str:
    """简单的 HTML 转纯文本（去标签，保留换行）。"""
    import re
    import html as html_module
    # 把 <p> <br> <div> 等块级标签换成换行
    text = re.sub(r"<(?:p|br|div|h[1-6]|li)[^>]*>", "\n", html, flags=re.IGNORECASE)
    # 去掉所有其他标签
    text = re.sub(r"<[^>]+>", "", text)
    # 反转义 HTML 实体（&amp; → & 等）
    text = html_module.unescape(text)
    return text


# ============================================================
# 工具 5：search_web（联网搜索，需要重试 + 超时）
# ============================================================
@retry_with_timeout(timeout=30.0, retries=5)
def search_web(query: str, count: int = 5) -> dict:
    """联网搜索（DuckDuckGo，免费无需 key）。

    注意：DuckDuckGo 在某些网络环境下偶发超时，所以这里超时和重试都设得比较宽松。
    """
    from ddgs import DDGS
    import os

    results = []
    # ddgs 库需要显式传 proxy 才会走系统代理（否则可能直连被墙）
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    ddgs = DDGS(proxy=proxy) if proxy else DDGS()
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
