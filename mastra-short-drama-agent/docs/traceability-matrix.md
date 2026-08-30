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
| R-001 | 首页直接开始新制作 | 对话首页 | create production | Ingestion | Project/Episode | E2E | planned |
| R-002 | 粘贴一集剧本 | 对话首页 | create ingestion | Script Ingestion | ScriptVersion | Parser/E2E | spike |
| R-003 | 上传 md/txt | 对话首页 | upload script | Script Ingestion | ScriptVersion/File | Upload test | planned |
| R-004 | 保存原始剧本版本 | 剧本工件 | get versions | Ingestion Service | ScriptVersion | Repository | spike |
| R-005 | 自动生成故事资产 | 活动流/资产工件 | start task | Story Understanding | StoryBible entities | Workflow | spike |
| R-006 | 展示角色卡 | 资产工件 | get characters | Asset Query | Character | UI/E2E | planned |
| R-007 | 展示场景卡 | 资产工件 | get locations | Asset Query | Location | UI/E2E | planned |
| R-008 | 展示道具、关系、时间线 | 资产工件 | get assets | Asset Query | Prop/Relationship/Timeline | UI/E2E | planned |
| R-009 | 自动生成场次 | 场次工件 | start production | Scene Planning | Scene | Workflow | spike |
| R-010 | 自动生成分镜卡片 | 分镜工件 | get shots | Storyboard Production | Shot | Production test | spike |
| R-011 | Image Prompt | 分镜工件 | get/edit shot | Prompt Generation | PromptVersion | Schema/Workflow | spike |
| R-012 | Video Prompt | 分镜工件 | get/edit shot | Prompt Generation | PromptVersion | Schema/Workflow | spike |
| R-013 | 不使用表格作为主界面 | 分镜工件 | N/A | N/A | N/A | UI review | planned |
| R-014 | 自动连续性审查 | 问题工件 | get issues | Continuity Review | Review/Issue | Review test | spike |
| R-015 | 低风险自动修订（仅限措辞/格式/明确性；事实内容只标记不自动改） | 问题工件 | retry/refine | Refine | Shot/PromptVersion | Refine test | spike |
| R-016 | 单镜失败隔离 | 会话 · 工件 | retry shot | Production Workflow | DomainTask/Shot | Failure test | spike |
| R-017 | 实时查看进度 | 会话活动流 | task status/stream | Task Runner | DomainTask | E2E | planned |
| R-018 | 生成中查看已完成内容 | 会话 · 工件 | asset query | Task Runner | All assets | E2E | planned |
| R-019 | 故事资产直接编辑 | 资产工件 | update asset | Asset Edit | Version tables | Edit test | planned |
| R-020 | 修改后自动影响分析 | 资产工件 | edit response | Impact Analysis | Impact records | Impact test | planned |
| R-021 | 自动重生成受影响内容（后台全自动执行，进度可见、可取消、不阻塞编辑） | 会话 · 工件 | create regeneration task | Partial Production | Versions | E2E | planned |
| R-022 | 分镜制作字段直接编辑 | 分镜工件 | update shot | Shot Edit | Shot version | Edit test | planned |
| R-023 | Prompt 直接编辑 | 分镜工件 | update prompt | Prompt Edit | PromptVersion | Version test | spike |
| R-024 | 查看 before/after diff | 版本工件 | get diff | Version Service | Version data | Diff test | spike |
| R-025 | 查看问题汇总工件 | 问题工件 | get issues | Issue Service | Review/Issue | UI/E2E | planned |
| R-026 | 忽略问题后仍可导出 | 问题/导出工件 | ignore issue/export | Export Workflow | ExportPackage | Export test | planned |
| R-027 | 失败项单独重试 | 问题工件 | retry scope | Retry Service | DomainTask | Retry test | spike |
| R-028 | 主对话界面（唯一入口） | 对话 | chat | Chat Router | Memory + audit | Chat E2E | spike |
| R-029 | 对话修改进入业务版本 | 对话 | chat edit | Change/Impact Service | Version | Chat edit test | planned |
| R-030 | 导出完整生产包（锁定 9 文件清单：5 Markdown + 4 JSON） | 导出工件 | export | Export Workflow | ExportPackage/File | Export E2E | spike |
| R-031 | 服务器部署 | 全系统 | Docker endpoints | API + Worker | PostgreSQL | Deploy smoke | planned |
| R-032 | 任务在服务重启后可恢复 | 进度页 | task query | Worker/Task lease | DomainTask | Restart test | spike |
| R-033 | Mock/Real 可切换 | 系统配置 | env/provider | Model Adapter | Run metadata | Config test | spike |
| R-034 | 第一版不做用户体系 | N/A | N/A | N/A | N/A | Scope review | confirmed |
| R-035 | 第一版不接真实图像/视频生成 | N/A | Prompt only | Provider interface | PromptVersion | Scope review | confirmed |
| R-036 | Mock 全链路生成 ≤ 2 分钟（验收硬指标；Real 不设时长指标） | 会话活动流 | mock full-pipeline e2e | 全链路 Workflow | Run metadata | E2E 计时测试 | planned |

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

- 用户可理解的对话流程；
- 首屏输入框导入；
- 资产卡片；
- 非审批自动连续流程；
- 故事资产编辑后的影响重生成；
- 服务器 Worker；
- 对话内活动流与工件体验；
- 上传文件；
- 问题汇总工件；
- 完整导出。

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
P0-A 对话界面骨架与会话历史栏
  → P0-B 剧本导入和任务进度
  → P0-C 自动连续生产 Workflow
  → P0-D 故事资产和分镜卡片
  → P0-E 编辑、影响分析和局部重生成
  → P0-F 问题中心和重试
  → P0-G 导出
  → P0-H Docker Server + Worker
```

在 P0 方案评审通过前，不进入这些实现任务。
