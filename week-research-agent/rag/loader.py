"""
文档加载 + 切块（Chunking）。

【为什么切块】
一份长文档可能几万字，直接塞进 prompt 会撑爆上下文。
切成小块（chunk），检索时只取最相关的几块。

【切块策略】
按字符数滑动窗口切块，相邻块有重叠（避免把句子切断丢失上下文）。
例：chunk_size=400, overlap=50
  块1：[0:400]
  块2：[350:750]    ← 和块1重叠 50 字
  块3：[700:1100]
"""
import os
from dataclasses import dataclass
from typing import List


@dataclass
class Chunk:
    """一个文档块。"""
    text: str           # 块文本
    source: str         # 来源（文件名）
    index: int          # 第几块


def load_text(filepath: str) -> str:
    """加载文本文件（.txt / .md）。"""
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


def load_directory(dirpath: str) -> List[tuple]:
    """加载目录下所有 .txt/.md 文件，返回 [(文件名, 内容), ...]。"""
    docs = []
    for fname in sorted(os.listdir(dirpath)):
        if fname.endswith((".txt", ".md")):
            path = os.path.join(dirpath, fname)
            docs.append((fname, load_text(path)))
    return docs


def chunk_text(text: str, source: str,
               chunk_size: int = 400, overlap: int = 50) -> List[Chunk]:
    """
    按滑动窗口切块。

    参数：
        text:       原始文本
        source:     来源文件名
        chunk_size: 每块字符数
        overlap:    相邻块重叠字符数（防止切断句子）
    """
    chunks = []
    start = 0
    idx = 0
    while start < len(text):
        end = start + chunk_size
        piece = text[start:end].strip()
        if piece:  # 跳过空白块
            chunks.append(Chunk(text=piece, source=source, index=idx))
            idx += 1
        start += chunk_size - overlap  # 滑动窗口
    return chunks


def chunk_documents(docs: List[tuple],
                    chunk_size: int = 400, overlap: int = 50) -> List[Chunk]:
    """对多个文档切块，返回所有块的列表。"""
    all_chunks = []
    for source, text in docs:
        all_chunks.extend(chunk_text(text, source, chunk_size, overlap))
    return all_chunks


# ============================================================
# 演示
# ============================================================
if __name__ == "__main__":
    sample = """
    LangChain 是一个用于开发由语言模型驱动的应用程序的开源框架。
    它提供了丰富的组件，包括模型接口、提示模板、记忆系统和工具调用。
    LangChain 的核心思想是将复杂的 AI 应用拆解为可组合的链式组件。

    LangChain 的主要模块包括：
    1. Models：统一封装各种 LLM 接口
    2. Prompts：管理提示词模板
    3. Memory：为对话提供记忆能力
    4. Chains：将多个组件串联成流水线
    5. Agents：让 LLM 自主决策调用工具

    LangChain 支持多种语言模型后端，包括 OpenAI、Anthropic、智谱等。
    它的设计目标是让开发者能快速构建复杂的 AI 应用。
    """.strip()

    print(f"原文长度：{len(sample)} 字符\n")
    chunks = chunk_text(sample, "sample.md", chunk_size=100, overlap=20)
    print(f"切成 {len(chunks)} 块（chunk_size=100, overlap=20）：\n")
    for c in chunks:
        print(f"--- 块 {c.index}（来源 {c.source}）---")
        print(c.text)
        print()
