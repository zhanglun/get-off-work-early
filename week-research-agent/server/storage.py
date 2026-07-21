"""
Day 10 持久化会话存储：用 SQLite 替换内存 dict。

【为什么用 SQLite】
Day 8 的 SESSIONS 是内存 dict——服务重启即丢失。
SQLite 是文件型数据库，零配置、零部署，重启数据还在。

【表设计】
messages 表：每条消息一行
  id | session_id | role | content | created_at

按 session_id 查询就是"取这个会话的历史"。

【为什么不用 Redis/PostgreSQL】
学习项目 SQLite 够用（单文件、零依赖）。
生产再升级到 Redis（快+过期）或 PostgreSQL（多用户+并发）。
"""
import os
import json
import sqlite3
import threading
from datetime import datetime
from typing import List, Dict, Optional

# 数据库文件路径（放在项目根）
DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "sessions.db",
)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# SQLite 连接的锁（SQLite 写操作要串行，多线程并发会锁库）
_db_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    """获取数据库连接（每次操作新建，SQLite 推荐做法）。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # 让查询结果像 dict 一样取值
    return conn


def init_db():
    """初始化数据库表（服务启动时调一次）。"""
    with _db_lock, _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        # 加速按 session_id 查询
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_session ON messages(session_id)"
        )


def get_history(session_id: str) -> List[Dict]:
    """取某会话的所有历史消息（按时间排序）。"""
    with _db_lock, _get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def append_message(session_id: str, role: str, content: str):
    """往某会话追加一条消息。"""
    with _db_lock, _get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (session_id, role, content, datetime.now().isoformat()),
        )
        conn.commit()


def append_history(session_id: str, messages: List[Dict]):
    """批量追加多条消息（一次会话结束存回用）。"""
    with _db_lock, _get_conn() as conn:
        for m in messages:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, m["role"], m["content"], datetime.now().isoformat()),
            )
        conn.commit()


def session_exists(session_id: str) -> bool:
    """检查会话是否已有历史。"""
    with _db_lock, _get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM messages WHERE session_id = ? LIMIT 1", (session_id,)
        ).fetchone()
    return row is not None


def get_or_create_session(session_id: Optional[str] = None) -> str:
    """获取或创建会话，返回 session_id（和内存版签名兼容）。"""
    import uuid
    if not session_id:
        session_id = str(uuid.uuid4())[:8]
    # SQLite 版：不需要"创建空会话"，有消息自然就存在
    # 这里只返回 id，真正创建发生在第一次 append_message
    return session_id


def count_sessions() -> int:
    """统计当前会话数（监控用）。"""
    with _db_lock, _get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(DISTINCT session_id) AS cnt FROM messages"
        ).fetchone()
    return row["cnt"] if row else 0


# ============================================================
# 启动时自动初始化
# ============================================================
init_db()

if __name__ == "__main__":
    # 自测
    print(f"数据库路径：{DB_PATH}\n")

    sid = "test_session_001"
    print(f"1. 会话 {sid} 存在吗？{session_exists(sid)}")

    append_message(sid, "user", "Python 是什么")
    append_message(sid, "assistant", "Python 是编程语言")
    print(f"2. 追加 2 条后，存在吗？{session_exists(sid)}")

    history = get_history(sid)
    print(f"3. 历史：{history}")

    print(f"4. 总会话数：{count_sessions()}")
    print("\n✓ 持久化存储工作正常")
