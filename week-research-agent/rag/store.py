"""
向量库封装：用 Chroma 存储和检索文档块。

【Chroma 是什么】
开源向量数据库，纯 Python，数据存本地文件夹，零配置。
适合学习/原型，生产可换 Pinecone/Weaviate/Milvus。

【核心操作】
- add：存一批文档块（文本 + 向量 + 元数据）
- query：给一个问题向量，找最相似的 N 个块
"""
import os
import sys
from typing import List, Dict, Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chromadb
from rag.loader import Chunk
from rag.embedder import embed, embed_batch


# 向量库存储路径（项目根的 data/chroma/）
CHROMA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "chroma",
)
COLLECTION_NAME = "knowledge_base"


class VectorStore:
    """向量库封装。"""

    def __init__(self):
        # Chroma 的 PersistentClient：数据存磁盘
        self.client = chromadb.PersistentClient(path=CHROMA_PATH)
        # 获取或创建 collection（相当于数据库的"表"）
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"description": "RAG 知识库"},
        )

    def add_chunks(self, chunks: List[Chunk]) -> int:
        """
        把文档块存进向量库。

        每个 chunk：文本 + 向量 + 元数据（source/index）
        """
        if not chunks:
            return 0

        # 批量向量化（比循环单条快）
        texts = [c.text for c in chunks]
        vectors = embed_batch(texts)

        # 生成唯一 ID（source_index 保证不重复）
        ids = [f"{c.source}_{c.index}" for c in chunks]

        # 存进 Chroma
        self.collection.add(
            ids=ids,
            documents=texts,
            embeddings=vectors,
            metadatas=[{"source": c.source, "index": c.index} for c in chunks],
        )
        return len(chunks)

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        检索：给一个问题，找最相似的 top_k 个文档块。

        返回 [{text, source, score}, ...]，按相似度从高到低。
        """
        # 问题向量化
        query_vec = embed(query)

        # Chroma 检索
        results = self.collection.query(
            query_embeddings=[query_vec],
            n_results=top_k,
        )

        # 整理结果
        hits = []
        documents = results["documents"][0] if results["documents"] else []
        metadatas = results["metadatas"][0] if results["metadatas"] else []
        distances = results["distances"][0] if results["distances"] else []

        for doc, meta, dist in zip(documents, metadatas, distances):
            hits.append({
                "text": doc,
                "source": meta.get("source", "?"),
                "score": round(1 - dist, 3),  # Chroma 距离转相似度（近似）
            })
        return hits

    def count(self) -> int:
        """当前向量库有多少文档块。"""
        return self.collection.count()

    def clear(self):
        """清空向量库（重新索引时用）。"""
        self.client.delete_collection(COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"description": "RAG 知识库"},
        )


# ============================================================
# 演示
# ============================================================
if __name__ == "__main__":
    print("=== VectorStore 演示 ===\n")

    store = VectorStore()
    store.clear()  # 先清空

    # 模拟几个文档块
    chunks = [
        Chunk("LangChain 是 AI 开发框架，支持工具调用和记忆", "doc1.txt", 0),
        Chunk("Python 是一种解释型编程语言，语法简洁", "doc2.txt", 0),
        Chunk("报销流程：填写申请单，附上发票，提交审批", "doc3.txt", 0),
    ]
    n = store.add_chunks(chunks)
    print(f"存入 {n} 个文档块，当前共 {store.count()} 块\n")

    # 检索测试
    for q in ["LangChain 有什么能力", "怎么报销", "Python 是什么"]:
        hits = store.search(q, top_k=1)
        hit = hits[0] if hits else None
        print(f"问：{q}")
        if hit:
            print(f"  → 最相关（score={hit['score']}，来源 {hit['source']}）")
            print(f"    {hit['text']}")
        print()
