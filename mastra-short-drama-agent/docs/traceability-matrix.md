# 需求追踪矩阵

> 状态：需求已确认，待方案评审和实现拆解
>
> 规则：只有同时具备页面、业务接口、数据/Workflow 支撑和测试证据，需求才可标记为完成。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| planned | 已进入方案，尚未实现 |
| spike | 现有技术验证代码部分覆盖，但不代表产品完成 |
| implementing | 正在按本方案实现 |
| verified | 页面、接口、数据和测试均有证据 |
| deferred | 明确延后 |

## 2. 核心需求矩阵

| ID | 需求 | 页面 | API/用例 | Workflow/服务 | 数据 | 测试 | 当前状态 |
|---|---|---|---|---|---|---|---|
| R-001 | 首页直接开始新制作 | 首页 | create production | Ingestion | Project/Episode | E2E | planned |
| R-002 | 粘贴一集剧本 | 首页 | create ingestion | Script Ingestion | ScriptVersion | Parser/E2E | spike |
| R-003 | 上传 md/txt | 首页 | upload script | Script Ingestion | ScriptVersion/File | Upload test | planned |
| R-004 | 保存原始剧本版本 | 原始剧本 | get versions | Ingestion Service | ScriptVersion | Repository | spike |
| R-005 | 自动生成故事资产 | 进度/故事资产 | start task | Story Understanding | StoryBible entities | Workflow | spike |
| R-006 | 展示角色卡 | 故事资产 | get characters | Asset Query | Character | UI/E2E | planned |
| R-007 | 展示场景卡 | 故事资产 | get locations | Asset Query | Location | UI/E2E | planned |
| R-008 | 展示道具、关系、时间线 | 故事资产 | get assets | Asset Query | Prop/Relationship/Timeline | UI/E2E | planned |
| R-009 | 自动生成场次 | 场次 | start production | Scene Planning | Scene | Workflow | spike |
| R-010 | 自动生成分镜卡片 | 分镜 | get shots | Storyboard Production | Shot | Production test | spike |
| R-011 | Image Prompt | 分镜卡片 | get/edit shot | Prompt Generation | PromptVersion | Schema/Workflow | spike |
| R-012 | Video Prompt | 分镜卡片 | get/edit shot | Prompt Generation | PromptVersion | Schema/Workflow | spike |
| R-013 | 不使用表格作为主界面 | 分镜 | N/A | N/A | N/A | UI review | planned |
| R-014 | 自动连续性审查 | 问题/分镜 | get issues | Continuity Review | Review/Issue | Review test | spike |
| R-015 | 低风险自动修订 | 问题/分镜 | retry/refine | Refine | Shot/PromptVersion | Refine test | spike |
| R-016 | 单镜失败隔离 | 进度/问题 | retry shot | Production Workflow | DomainTask/Shot | Failure test | spike |
| R-017 | 实时查看进度 | 进度页 | task status/stream | Task Runner | DomainTask | E2E | planned |
| R-018 | 生成中查看已完成内容 | 进度页/资产页 | asset query | Task Runner | All assets | E2E | planned |
| R-019 | 故事资产直接编辑 | 故事资产 | update asset | Asset Edit | Version tables | Edit test | planned |
| R-020 | 修改后自动影响分析 | 故事资产 | edit response | Impact Analysis | Impact records | Impact test | planned |
| R-021 | 自动重生成受影响内容 | 进度/资产 | create regeneration task | Partial Production | Versions | E2E | planned |
| R-022 | 分镜制作字段直接编辑 | 分镜卡 | update shot | Shot Edit | Shot version | Edit test | planned |
| R-023 | Prompt 直接编辑 | 分镜卡 | update prompt | Prompt Edit | PromptVersion | Version test | spike |
| R-024 | 查看 before/after diff | 版本 | get diff | Version Service | Version data | Diff test | spike |
| R-025 | 查看问题中心 | 问题 | get issues | Issue Service | Review/Issue | UI/E2E | planned |
| R-026 | 忽略问题后仍可导出 | 问题/导出 | ignore issue/export | Export Workflow | ExportPackage | Export test | planned |
| R-027 | 失败项单独重试 | 问题/分镜 | retry scope | Retry Service | DomainTask | Retry test | spike |
| R-028 | 右侧聊天辅助 | 工作区 | chat | Chat Router | Memory + audit | Chat E2E | spike |
| R-029 | 聊天修改进入业务版本 | 工作区 | chat edit | Change/Impact Service | Version | Chat edit test | planned |
| R-030 | 导出完整生产包 | 导出 | export | Export Workflow | ExportPackage/File | Export E2E | spike |
| R-031 | 服务器部署 | 全系统 | Docker endpoints | API + Worker | PostgreSQL | Deploy smoke | planned |
| R-032 | 任务在服务重启后可恢复 | 进度页 | task query | Worker/Task lease | DomainTask | Restart test | spike |
| R-033 | Mock/Real 可切换 | 系统配置 | env/provider | Model Adapter | Run metadata | Config test | spike |
| R-034 | 第一版不做用户体系 | N/A | N/A | N/A | N/A | Scope review | confirmed |
| R-035 | 第一版不接真实图像/视频生成 | N/A | Prompt only | Provider interface | PromptVersion | Scope review | confirmed |

## 3. 当前 Spike 覆盖说明

现有实现已经验证部分后端能力：

- Markdown Parser；
- StoryBible/Scene/Shot 基础数据模型；
- Prompt/Review/Refine；
- PostgreSQL 落库；
- 基础 API；
- Mock 全链路；
- 基础导出。

但以下内容不能因为 Spike 测试通过而标记 `verified`：

- 用户可理解的页面流程；
- 首页直接导入；
- 资产卡片；
- 非审批自动连续流程；
- 故事资产编辑后的影响重生成；
- 服务器 Worker；
- 实时进度体验；
- 上传文件；
- 问题中心；
- 完整导出页面。

## 4. 验收证据要求

每个 `verified` 需求至少需要以下证据中的三类：

1. 页面操作证据；
2. API 或服务测试；
3. 数据库记录；
4. Workflow 运行记录；
5. 自动化测试；
6. 手工验收记录。

## 5. 需求到开发任务

实现顺序建议：

```text
P0-A 页面骨架和导航
  → P0-B 剧本导入和任务进度
  → P0-C 自动连续生产 Workflow
  → P0-D 故事资产和分镜卡片
  → P0-E 编辑、影响分析和局部重生成
  → P0-F 问题中心和重试
  → P0-G 导出
  → P0-H Docker Server + Worker
```

在 P0 方案评审通过前，不进入这些实现任务。
