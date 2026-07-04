# 一周 Research Agent

7 天从零实现一个能联网搜索、多步推理、生成研究报告的 AI Agent。

> 核心理念：**先学原理，再学框架。** 这个项目全程手写 Agent Loop / Tool Calling / State，不依赖 LangChain / LangGraph。

## 技术栈

| 组件 | 选择 | 说明 |
|------|------|------|
| LLM | 智谱 GLM-4-Flash | 免费档，原生 function calling |
| 搜索 | 智谱 web_search | 原生工具，无需第三方 key |
| Web | FastAPI | Day 7 部署用 |

## 环境准备

```bash
# 1. 安装依赖
cd week-research-agent
pip install -r requirements.txt

# 2. 配置 API Key
cp .env.example .env
# 然后编辑 .env，填入你的智谱 API Key
# 申请地址：https://open.bigmodel.cn/usercenter/apikeys

# 3. 验证配置
python config.py
```

## 学习路线

| Day | 主题 | 目录 | 运行命令 |
|-----|------|------|---------|
| 1 | 最小 Agent（单步工具调用） | `day1/` | `python day1/agent.py` |
| 2 | Tool Calling 全链路 + 多工具 | `day2/` | `python day2/agent.py` |
| 3 | 多步 + State + 真实搜索 | `day3/` | `python day3/agent.py` |
| 4 | 健壮性（日志/重试/结构化输出） | `day4/` | `python day4/agent.py` |
| 5 | 完整 Research Agent | `research_agent/` | `python research_agent/__main__.py` |
| 6 | Evaluation 评估 | `evaluation/` | `python evaluation/run_eval.py` |
| 7 | 部署上线 | `server/` | `python server/main.py` |

## 学完你会掌握

- [x] Agent 的本质：`LLM + Tool + Loop`
- [x] Tool Calling 全链路（Schema → Function Call → Python → Observation → Answer）
- [x] Tool Schema（给 LLM 看）vs Tool Registry（给 Python 看）的区别
- [x] State 管理 / max_steps 防死循环
- [x] 健壮性：日志、重试、错误处理
- [x] Evaluation：如何量化评估一个 Agent
- [x] 部署：把 Agent 变成可调用的 API 服务

## 对应理论概念

本项目每天的代码都对应 [学习笔记](../Agent_Learning_Context_Lesson01_02.md) 里的概念：

```
LLM → Tool Calling → Python Tool → Observation → Agent Loop
```
