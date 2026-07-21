"""
Embedding 封装：把文本转成向量。

【什么是 Embedding】
把一段文本变成一个数字数组（向量），让"语义相近的文本"向量也相近。
这样就能用数学方法（算距离）判断"两段话意思是否相关"。

【为什么用本地模型】
智谱 embedding-2 收费（免费档无额度），所以用 sentence-transformers 的本地模型。
首次运行会下载模型（约 100MB），之后离线可用。

【模型选择】
BAAI/bge-small-zh-v1.5：中文优化，体积小（~100MB），适合学习。
"""
from typing import List
from functools import lru_cache


@lru_cache(maxsize=1)
def _get_model():
    """懒加载模型（只加载一次，缓存复用）。首次调用会下载。"""
    from sentence_transformers import SentenceTransformer
    # bge-small-zh：中文优化的小模型，512 维向量
    model = SentenceTransformer("BAAI/bge-small-zh-v1.5")
    return model


def embed(text: str) -> List[float]:
    """把单段文本转成向量。"""
    model = _get_model()
    # bge 模型推荐给 query 加前缀"为这个句子生成表示以用于检索相关文章："
    vec = model.encode([text], normalize_embeddings=True)
    return vec[0].tolist()


def embed_batch(texts: List[str]) -> List[List[float]]:
    """批量向量化（比循环单条快得多）。"""
    model = _get_model()
    vecs = model.encode(texts, normalize_embeddings=True)
    return [v.tolist() for v in vecs]


# ============================================================
# 演示
# ============================================================
if __name__ == "__main__":
    print("=== Embedding 演示（首次会下载模型）===\n")

    texts = [
        "LangChain 是一个 AI 开发框架",
        "LangChain 是用来做 AI 应用的",
        "今天天气真好，适合出去玩",
    ]

    vecs = embed_batch(texts)
    print(f"向量维度：{len(vecs[0])}")
    print(f"前 5 维（归一化后）：{[round(x, 3) for x in vecs[0][:5]]}\n")

    # 计算相似度（归一化后点积 = 余弦相似度）
    def similarity(a, b):
        return sum(x * y for x, y in zip(a, b))

    print("=== 相似度验证（语义检索的原理）===")
    print(f"'{texts[0]}' vs '{texts[1]}'：{similarity(vecs[0], vecs[1]):.3f}（相关）")
    print(f"'{texts[0]}' vs '{texts[2]}'：{similarity(vecs[0], vecs[2]):.3f}（不相关）")
    print("\n→ 语义相关的文本，相似度更高。这就是 RAG 检索的基础。")
