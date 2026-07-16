"""
Workflow 包：Day 8 阶段 B+C——把单课题研究升级为多步深度研究。

架构：
    大课题 → [Planner 拆解] → 子课题们
                                ↓
             [Executor 执行] ← 每个子课题跑一次 research_agent
                                ↓
             [Synthesizer 综合] → 完整总报告

运行方式：python -m workflow
"""
