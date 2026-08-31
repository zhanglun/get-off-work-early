# 图表资产索引

> 由 fireworks-tech-graph 流程生成（2026-08-30），配色对齐 DESIGN.md「场记日志」世界：
> 米纸底 `#f7f6f1` · 墨线 `#22242c` · 工作蓝=主流程 · 校对红=失败/错误 · 圈码金=实时/当前。
> SVG 为源文件（全部通过 XML/标记/碰撞/语义/构图五项校验），PNG 为 2x 导出副本。

| 图 | 内容 | 引用位置 |
|---|---|---|
| `系统架构图` | 客户端 / NestJS API / Mastra 编排 / Worker 与数据 四层架构；REST、SSE（金）、模型调用、真实模型失败路径（红） | `architecture.md` §10 |
| `生成流程图` | 登录→导入→补问→自动连续管线（六阶段横带）→穿帮处理→导出；单镜失败重试旁路（红）、取消虚线 | `product-design.md` §6 |
| `修改重生成时序图` | 打字修改→意图路由→影响分析→确认→Worker 局部重生成（loop 每集一次）→SSE 原位更新 | `product-design.md` §9 |
| `数据模型图` | 14 实体 ER：项目域 / 制作域 / 运行域（右轨挂载 DomainTask·Event·ExportPackage） | `architecture.md` §3 |
| `技术路线图` | M0–M7 里程碑横带（M0 金圈当前）+ 技术债泳道（Redis/S3/认证/媒体 Provider 及触发条件） | `tech-roadmap.md` |
| `产品路线图` | v1.0→v1.x→v2.0→v3.0 四版卡片 + 触发条件菱形 + 暂不规划框 | `product-roadmap.md` |

## 交互版（archify 生成）

静态图之外，三张核心图提供可交互 HTML（主题切换 / 缩放 / 关系追踪）：

| 文件 | 质量 | 校验 |
|---|---|---|
| `系统架构图.html` | showcase | 四视口 containment 全过 |
| `生成流程图.html` | standard（泳道网格的 showcase 约束未收敛，按契约降级并披露） | 四视口 containment 全过 |
| `修改重生成时序图.html` | showcase | 四视口 containment 全过 |
