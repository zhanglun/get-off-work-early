# AI Platform / Tech Lead Interview Handbook

> Version: 1.0
> Author: Lun Zhang

一本围绕真实项目展开的 AI Platform / Tech Lead 面试推演文档。

不是八股，不是题库，而是**模拟真实技术面试**的完整过程：每一题都有追问、架构分析、常见错误、推荐回答。

## 项目定位

- 唯一目标：输出一套完整、系统、可阅读的面试文档
- 预计 200+ 问题
- 所有内容来源于真实工作
- 最终可用 Web 阅读，但重点是**内容**

## 目录结构

```
ai-platform-interview-handbook/
├── README.md                      # 本文件（索引 + 说明）
├── STYLE-GUIDE.md                 # 写作风格指南（模板 + 原则）
├── handleoff.md                   # 项目交接文档（写作要求的原始定义）
└── docs/
    ├── chapter-01-introduction.md      # 第一章 个人介绍
    ├── chapter-02-projects.md           # 第二章 项目经历
    ├── chapter-03-engineering.md        # 第三章 工程化
    ├── chapter-04-task-platform.md      # 第四章 Task Platform（重点）
    ├── chapter-05-ai-platform.md        # 第五章 AI Platform
    ├── chapter-06-nodejs.md             # 第六章 Node.js
    ├── chapter-07-redis.md              # 第七章 Redis
    ├── chapter-08-postgresql.md         # 第八章 PostgreSQL
    ├── chapter-09-system-design.md      # 第九章 系统设计
    ├── chapter-10-team-management.md    # 第十章 团队管理
    ├── chapter-11-behavioral.md         # 第十一章 行为面试
    ├── chapter-12-docker-k8s.md         # 第十二章 Docker & Kubernetes
    └── chapter-13-go-basics.md          # 第十三章 Go 语言基础
```

## 章节索引

| 章节 | 标题 | 状态 | 题目数 |
|------|------|------|--------|
| [第一章](docs/chapter-01-introduction.md) | 个人介绍 | ✅ 已完成 | 7 |
| [第二章](docs/chapter-02-projects.md) | 项目经历 | ✅ 已完成 | 27 |
| [第三章](docs/chapter-03-engineering.md) | 工程化 | ✅ 已完成 | 12 |
| [第四章](docs/chapter-04-task-platform.md) | Task Platform（重点） | ✅ 已完成 | 29 |
| [第五章](docs/chapter-05-ai-platform.md) | AI Platform | ✅ 已完成 | 19 |
| [第六章](docs/chapter-06-nodejs.md) | Node.js | ✅ 已完成 | 15 |
| [第七章](docs/chapter-07-redis.md) | Redis | ✅ 已完成 | 14 |
| [第八章](docs/chapter-08-postgresql.md) | PostgreSQL | ✅ 已完成 | 14 |
| [第九章](docs/chapter-09-system-design.md) | 系统设计 | ✅ 已完成 | 18 |
| [第十章](docs/chapter-10-team-management.md) | 团队管理 | ✅ 已完成 | 10 |
| [第十一章](docs/chapter-11-behavioral.md) | 行为面试 | ✅ 已完成 | 7 |
| [第十二章](docs/chapter-12-docker-k8s.md) | Docker & Kubernetes | ✅ 已完成 | 10 |
| [第十三章](docs/chapter-13-go-basics.md) | Go 语言基础 | ✅ 已完成 | 8 |
| **合计** | | **全部完成** | **190** |

## 写作原则

1. 模拟真实技术面试，不是 Q&A 合集
2. 每题有追问链：Question → 候选人回答 → 面试官追问 → ... → 架构分析 → 推荐回答
3. 每题回答六要素：需求背景 / 为什么不用其它方案 / 为什么选当前 / 优缺点 / 如何扩展 / 重新设计怎么做
4. 不写八股，基础知识自然融入项目
5. 按章节逐步生成

详见 [STYLE-GUIDE.md](STYLE-GUIDE.md)
