# 架构图表（fireworks-tech-graph 生成）

> 2026-08-30 随对话形态架构更新绘制。SVG 为源文件（可校验/可改），PNG 为导出副本。
> 视觉风格：Blueprint（#0a1628），与产品「凌晨片场」视觉语言同源。

| 图 | 文件 | 内容 |
|---|---|---|
| 系统架构图 | `architecture-conversation.svg/.png` | 六层架构：对话前端 → API/SSE → Chat Router（唯一入口）→ Workflow/Worker → Agent/Rules → 数据层；实线主流程、虚线异步持久化 |
| 打字修改时序图 | `sequence-chat-edit.svg/.png` | "把林小雨的风衣改成深灰大衣"全链路：意图路由 → 影响分析 → G2A 自动重生成 → 事件 journal → SSE 推送 → 工件原位更新 |
| 生产流程图 | `flow-production.svg/.png` | 自动连续流水线 + 三条回路：修改回路（G2A）、失败回路（单项隔离）、不中断旁路（忽略写 manifest） |

全部通过 `validate-svg.sh`（XML/标记/箭头碰撞/语义几何/构图/渲染六项校验）与人工视觉审查。
