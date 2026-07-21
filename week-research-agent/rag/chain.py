"""
RAG 主流程：把"检索"和"生成"串起来。

【完整 RAG 流程】
1. 用户提问
2. 检索：问题向量化 → 从向量库找最相关的几个文档块
3. 生成：把检索到的内容塞进 prompt → LLM 基于内容回答

【核心 prompt 设计】
告诉 LLM："只能基于提供的参考资料回答，不知道就说不知道"。
这是防止幻觉的关键——RAG 的答案必须可溯源。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from zhipuai import ZhipuAI
from config import Config
from rag.store import VectorStore


RAG_PROMPT_TEMPLATE = """请根据以下参考资料回答用户的问题。

【要求】
1. 只基于参考资料回答，不要编造资料里没有的内容
2. 如果资料不足以回答问题，诚实说"根据现有资料无法回答"
3. 回答要简洁准确，引用资料里的关键信息

【参考资料】
{context}

【用户问题】
{question}"""


def build_context(hits) -> str:
    """把检索结果格式化成 context 文本。"""
    parts = []
    for i, hit in enumerate(hits, 1):
        parts.append(f"[资料 {i}]（来源：{hit['source']}，相关度：{hit['score']}）\n{hit['text']}")
    return "\n\n".join(parts)


def ask(question: str, top_k: int = 3, verbose: bool = True) -> dict:
    """
    RAG 问答：检索 + 生成。

    参数：
        question: 用户问题
        top_k:    检索几个最相关的文档块
        verbose:  是否打印检索过程
    返回：
        {question, answer, sources, hits}
    """
    Config.check()
    client = ZhipuAI(api_key=Config.API_KEY)
    store = VectorStore()

    # ===== 步骤 1：检索 =====
    hits = store.search(question, top_k=top_k)
    if verbose:
        print(f"\n🔎 检索到 {len(hits)} 个相关文档块：")
        for h in hits:
            print(f"   • [{h['source']}] score={h['score']} | {h['text'][:50]}...")

    if not hits:
        return {
            "question": question,
            "answer": "向量库为空，无法检索。请先索引文档。",
            "sources": [],
            "hits": [],
        }

    # ===== 步骤 2：构建 prompt =====
    context = build_context(hits)
    prompt = RAG_PROMPT_TEMPLATE.format(context=context, question=question)

    # ===== 步骤 3：生成 =====
    response = client.chat.completions.create(
        model=Config.MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,  # 低温度，让答案稳定、忠实于资料
    )
    answer = response.choices[0].message.content or ""

    return {
        "question": question,
        "answer": answer,
        "sources": list({h["source"] for h in hits}),
        "hits": hits,
    }


def index_directory(dirpath: str, verbose: bool = True) -> int:
    """
    索引一个目录：加载所有文档 → 切块 → 存进向量库。

    返回存入的块数。
    """
    from rag.loader import load_directory, chunk_documents
    from rag.store import VectorStore

    docs = load_directory(dirpath)
    if verbose:
        print(f"📂 加载 {len(docs)} 个文档：{[d[0] for d in docs]}")

    chunks = chunk_documents(docs, chunk_size=400, overlap=50)
    if verbose:
        print(f"✂️  切成 {len(chunks)} 个文档块")

    store = VectorStore()
    store.clear()  # 重新索引前清空
    n = store.add_chunks(chunks)
    if verbose:
        print(f"💾 存入向量库，共 {store.count()} 块")
    return n


if __name__ == "__main__":
    import json

    print("=== RAG Chain 演示 ===")
    print("（需要先有文档在 knowledge/ 目录，并已索引）\n")

    # 如果有 knowledge 目录，自动索引
    kb_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "knowledge")
    if os.path.isdir(kb_dir) and os.listdir(kb_dir):
        print("--- 自动索引 knowledge/ 目录 ---")
        index_directory(kb_dir)

        print("\n--- 测试问答 ---")
        for q in ["LangChain 有什么模块", "报销流程是什么"]:
            print(f"\n{'='*50}")
            print(f"❓ 问：{q}")
            result = ask(q, verbose=True)
            print(f"\n💬 答：{result['answer']}")
            print(f"📎 来源：{result['sources']}")
    else:
        print("⚠️ 没有 knowledge/ 目录或为空。请创建并放入 .txt 文件后重试。")
