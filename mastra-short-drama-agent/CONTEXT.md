# Short Drama Agent 项目上下文交接

> 用途：每次会话开始时先读取本文件，再继续工作。
> 更新时间：2026-08-30
> 当前状态：**三基线 + 双路线图全部定案，实现未启动**——下一步执行 M0（实现规划 + monorepo 重组），goal 提示词已备好。

## 1. 当前最重要的规则

**实现严格按基线推进：基线未覆盖的决策必须问答确认，不得自行扩大范围。**

历史教训：曾在需求未确认时直接实现后端 Workflow、Repository 和 API，被用户明确否决。因此：

1. 基线文档优先于任何现有代码；
2. 实现从 M0 开始：先产出 `docs/implementation-plan.md`（复用/重构/新增/淘汰四张清单）并完成 monorepo 重组，未完成此步不写功能代码；
3. 每完成一个里程碑（M0–M7），更新本文件 §7 进度记录。

会话正确开场：

1. 读本文件；
2. 读 `docs/product-design.md`、`docs/architecture.md`、`DESIGN.md`、`docs/product-roadmap.md`、`docs/tech-roadmap.md`；
3. 对照 §7 当前进度，继续当前里程碑或向用户确认下一步。

## 2. 三份基线（均已用户确认）

### 产品基线 `docs/product-design.md`

Demo 账号登录（demo / demo123，7 天会话）→ 共享项目列表（隐藏管理重置）→ 项目主对话导入剧本（依次补问项目名→集数→镜头数，建议 20–40 默认 30）→ 一键自动连续生成（无确认门槛）→ 边栏阶段账 + 图版区实时生长（资产/分镜卡/穿帮）→ 打字修改（跨集影响分析 → 确认 → 局部重生成）→ 版本（保留 5 版/diff/回退）→ 穿帮处理（措辞自动修订、事实只标记）→ 整项目 ZIP 导出。

关键产品决策：项目级资产 + 本集覆盖；冲突三选；同项目一次只制作一集；单镜失败隔离可重试；取消保留已完成；真实模型失败自动 Mock 并以红色 MOCK 印章披露；被忽略穿帮写入 manifest。

### 视觉基线 `DESIGN.md` + `docs/mockups/ui-visual-draft.html`

「场记日志」世界：米纸 `#f7f6f1` / 墨线结构 / 工作蓝=动作 / 校对红=穿帮与印章 / 圈码金=手圈数字与注意标记 / 楷体眉批 / 等宽只用于编号与时间码。签名元素：圈码椭圆（当前项金圈描线动画）。

构图 comp-c（编号边栏 + 对话列 + 图版列）；**边栏阶段账取代右侧双视图 tab（§8 修订已确认）**。视觉稿含 5 状态（登录/列表/制作中/完成/修改确认），经两轮 finish review 终裁 ship。

### 技术基线 `docs/architecture.md`

NestJS（API 层：module/guard/controller/service）+ Mastra 作为库（agents/workflows/结构化输出）+ Worker 独立进程；React 18 + Vite + TanStack Query；PostgreSQL 16 + Prisma（任务租约 SKIP LOCKED）；SSE + 事件表 journal（afterSeq 续传）；原地改造为 pnpm monorepo（apps/server + apps/web + packages/shared）；真实模型先行（OpenAI 兼容接口），Mock 仅兜底。

## 3. 路线图

- **产品**：v1.0 Demo 闭环（当前）→ v1.x 打磨 → v2.0 多用户生产化 → v3.0 真实媒体生成。触发条件与验收见 `docs/product-roadmap.md`。
- **技术**：M0 规划与重组 → M1 登录与项目 → M2 导入与补问 → M3 生成与活动流 → M4 图版工件 → M5 修改与版本 → M6 ZIP 导出 → M7 部署与恢复。每里程碑交付物与验收信号见 `docs/tech-roadmap.md`。

## 4. 现有代码定位

`src/` 为技术 Spike（裸 node:http + 内存 Job Map + 强制确认门槛 + `public/` 演示页已删），**不代表产品完成**。M0 时按四张清单处置：

```text
复用：Markdown Parser、Zod 领域 Schema、Mastra Agents、Prisma schema/迁移
重构：API（→NestJS）、任务系统（→PG 任务表）、生成流程（→无门槛自动连续）
新增：会话/事件 journal、影响分析、版本管道、整项目导出、React 前端
淘汰：强制 StoryBible/Scene 确认门槛、内存 Job Map、node:http 手写路由
```

## 5. 文档清单

```text
CONTEXT.md                      本文件（工作规则 + 进度）
PRODUCT.md                      产品事实摘要（impeccable 维护）
DESIGN.md                       视觉世界令牌（实现必读）
docs/product-design.md          产品基线
docs/architecture.md            技术基线
docs/product-roadmap.md         产品路线图
docs/tech-roadmap.md            技术路线图
docs/mockups/ui-visual-draft.html  视觉稿（5 状态）
docs/assets/                 架构/流程/时序/ER/双路线图（SVG+PNG）
docs/implementation-plan.md     M0 产出（待创建）
```

历史方案文档（对话即产品时期的 prd / IA / flows / 状态机 / 追踪矩阵等）已全部删除，需要时从 git 历史恢复。

## 6. 相关仓库

- `agent-base/storyboard-agent`：历史 NestJS 分镜基线，冻结参考；
- `mastra-playground/`：Mastra 通用学习，与本项目无直接依赖。

## 7. 进度记录

- 2026-08-30：产品/视觉/技术定案 + 双路线图落盘（见上文）。
- 2026-08-30：**M0 完成**——implementation-plan.md 四张清单（复用/重构/新增/淘汰）+ monorepo 原地重组提交；`pnpm -r check` 通过、server 测试 10/10。
- 2026-08-30：**M1 完成**——NestJS auth/projects/events(SSE)/admin 四模块 + shared 契约包 + 前端登录/列表/工作区骨架；m1_baseline 迁移落库；curl 与浏览器双验收通过。
- 2026-08-30：**M2 完成**——chat 补问状态机（集数→镜头数）+ ScriptVersion 只读登记 + 前端对话流（SSE 实时）；m2_episode_meta 迁移。
- 2026-08-30：**M3 完成**——自动连续管线（无门槛）+ Worker SKIP LOCKED 租约 + SSE 阶段事件 + 前端阶段账/图版区/MOCK 印章；失败注入与取消验证通过（mock 路径；真实 Key 待用户提供后同链路复验）。下一步 M4。

## 8. 下一步

用已备好的 goal 提示词启动 `/goal`，从 M0 开始按 `docs/tech-roadmap.md` 顺序执行。
