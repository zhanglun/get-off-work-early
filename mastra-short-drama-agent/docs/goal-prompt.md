# goal 提示词（实现阶段）

> 用法：粘贴给 `/goal`。技术栈与验收已与 docs/architecture.md、docs/tech-roadmap.md 对齐。

```text
完成短剧分镜制作助手 Demo 的实现规划与第一版实现。

## 目标

按已定案的三份基线，把 mastra-short-drama-agent 从冻结 Spike 变为可运行 Demo：

- 产品基线：docs/product-design.md（唯一产品依据）
- 视觉基线：DESIGN.md + docs/mockups/ui-visual-draft.html（「场记日志」）
- 技术基线：docs/architecture.md（已确认的技术选型）
- 项目规则：CONTEXT.md（每次会话先读）

## 技术栈（已确认，不得偏离）

- NestJS（API：module/guard/controller/service，AuthGuard + cookie 会话）
  + Mastra 作为库装入 provider（agents/workflows/结构化输出）
- React 18 + Vite SPA + TanStack Query
- PostgreSQL 16 + Prisma（Spike schema 迁移扩展，任务租约 SKIP LOCKED）
- SSE + 事件表 journal（afterSeq 续传，刷新先快照）
- 原地改造为 pnpm monorepo：apps/server（现 src/ 迁入）+ apps/web + packages/shared
- 模型：OpenAI 兼容接口，开发即配真实 Key（真实模型先行）；失败自动 Mock 并以红色 MOCK 印章披露
- 认证：demo/demo123，HttpOnly 签名 cookie 7 天；管理口令重置

## 第一步：实现规划（先审后写）

通读现有 Spike 全部代码，对照三份基线产出复用/重构/新增/淘汰四张清单，
写入 docs/implementation-plan.md；随后一次性 git mv 完成 monorepo 重组
（重组提交与功能提交分开）；未完成此步不得开始功能写码。

## 实现范围（按序，每步可独立验收，详见 docs/tech-roadmap.md）

P0-A 登录 + 共享项目列表 + 隐藏管理重置
P0-B 项目/剧集/项目级资产模型 + 对话导入剧本（依次补问项目名→集数→镜头数，建议 20–40 默认 30）
P0-C 自动连续生成（无确认门槛）+ SSE 活动流 + 边栏阶段账（剧本→资产→场次→分镜→检查→穿帮→包）
P0-D 图版区工件：资产/分镜卡（含模拟帧标注）/穿帮（措辞自动修订、事实只标记）
P0-E 打字修改 + 跨集影响分析 + 确认后局部重生成 + 版本（保留 5 版、diff、回退）
P0-F 整项目 ZIP 导出（project-assets.md + 每集 5 文件，被忽略穿帮写入 manifest）
P0-G Docker API + Worker 分离部署，任务持久化可恢复

## 硬约束

- 单镜失败隔离可重试；取消保留已完成；同一项目一次只制作一集
- 前端按 DESIGN.md 令牌：米纸 #f7f6f1、墨线结构、蓝=动作、红=穿帮/印章、金=圈码与注意标记、楷体眉批
- SSE 事件契约放 packages/shared，前后端共用类型；校验统一 Zod
- 不做：WebSocket、Redis/BullMQ、微服务、K8s、真实图像/视频生成、多租户
- 每完成一个 P0 阶段，更新 CONTEXT.md 进度记录

## 验收（完成定义）

全部满足才算完成：
1. 浏览器登录 demo 账号 → 新建项目 → 粘贴真实剧本 → 补问链路 → 自动生成全程可见
2. 边栏阶段账实时推进，图版区逐件出现资产、分镜卡（模拟帧标注）、穿帮
3. 打字修改"把林小雨的风衣改成深灰大衣"→ 显示跨集影响 → 确认 → 重生成出新版本
4. 单镜失败可单项重试；被忽略穿帮出现在导出 manifest
5. 一键下载整项目 ZIP，目录结构与 product-design.md §12 一致
6. 真实模型配置后全链路使用真实输出；未配 Key 时 Mock 兜底可跑通 1–5 并标注 MOCK
7. pnpm check 与测试通过；Docker Compose 启动 postgres + api + worker，重启后任务与数据可恢复

## 边界

遇到三份基线均未覆盖的决策：按 CONTEXT.md 问答规则向我确认，不得自行扩大范围；
Spike 与新基线冲突时以新基线为准并记录淘汰项。
```
