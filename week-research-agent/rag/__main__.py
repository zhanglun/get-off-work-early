"""
RAG CLI 入口。

用法：
    python -m rag index          # 索引 knowledge/ 目录
    python -m rag ask "问题"      # 问一个问题
    python -m rag                 # 交互式问答
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.chain import ask, index_directory

KNOWLEDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "knowledge"
)


def main():
    args = sys.argv[1:]

    if args and args[0] == "index":
        # 索引模式
        if not os.path.isdir(KNOWLEDGE_DIR):
            print(f"✗ 目录不存在：{KNOWLEDGE_DIR}")
            print("  请创建 knowledge/ 目录并放入 .txt/.md 文件")
            return
        n = index_directory(KNOWLEDGE_DIR)
        print(f"\n✅ 索引完成，共 {n} 块")
        return

    if args and args[0] == "ask" and len(args) > 1:
        # 单次问答
        question = " ".join(args[1:])
        result = ask(question, verbose=True)
        print(f"\n💬 答：{result['answer']}")
        print(f"\n📎 来源：{result['sources']}")
        return

    # 交互模式
    print("=" * 50)
    print(" 📚 RAG 知识库问答")
    print(" 基于本地文档回答问题（不是搜互联网）")
    print("=" * 50)

    from rag.store import VectorStore
    store = VectorStore()
    if store.count() == 0:
        print("\n⚠️  向量库为空。请先运行：python -m rag index")
        print(f"   并在 {KNOWLEDGE_DIR}/ 放入 .txt/.md 文档")
        return

    print(f"   当前知识库：{store.count()} 个文档块")
    print("   输入 quit 退出\n")

    while True:
        try:
            question = input("❓ 问 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break
        if not question:
            continue
        if question.lower() in ("quit", "exit", "q"):
            break

        result = ask(question, verbose=True)
        print(f"\n💬 答：{result['answer']}")
        print(f"📎 来源：{result['sources']}\n")


if __name__ == "__main__":
    main()
