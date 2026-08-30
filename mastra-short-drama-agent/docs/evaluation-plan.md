# 短剧制作协作 Agent：评估计划

## 当前评估层级

### 结构与契约

- Parser 能识别基础 Markdown 场次格式。
- Parser 能识别接近行业剧本的 INT/EXT 格式。
- 无法识别场次时输出 warning，不伪造场次。
- Agent 输出经过 Zod Schema 校验。

### Workflow 门槛

- 未确认 StoryBible 不能规划 Scene。
- 未确认 Scene 不能生产 Shot。
- 高风险冲突阻断 StoryBible 确认。
- 单镜失败不影响同批其他镜头。
- Reviewer → Refiner → Reviewer 按最大轮数停止。

### 业务质量

后续为每个样本记录：

- 角色一致性
- 场景/道具/时间连续性
- 动作物理逻辑
- 分镜可执行性
- 提示词完整度
- 人工修改率
- needs_review 比例
- Token 与延迟
- 导出成功率

### 业务效果

旧系统只作为可选对比基线：

```text
新提示词 vs 旧提示词
  → 盲测选择
  → 新旧评分
  → 按镜头和整体汇总
```

它不能阻塞没有 Legacy API 时的新系统主流程。

## Fixture 测试

当前代码使用 Mock 模式制造可重复的审查循环：

```text
第 1 轮：prompt-specificity 不通过
Refiner：补充动作结束状态
第 2 轮：通过
```

Mock 只证明流程和边界，不代表真实模型质量。真实模型评估需要独立记录模型、版本、输入和输出。

## 当前真实模型验证状态

当前执行环境未发现 `OPENAI_API_KEY`、`ZHIPU_API_KEY` 或其他可用 Provider Key，因此 Real LLM 调用尚未执行。本项目已验证 Real 代码路径可以通过 TypeScript 和 Mastra Build；真实模型的输出质量、Token 和延迟仍需在配置 Provider Key 后单独验收，不能把 Mock 结果当作真实质量证据。

## 真实模型评估要求

配置 Real 模式后，至少运行：

- 5 个基础剧本样本
- 角色一致性样本
- 跨场景连续性样本
- 含道具状态变化样本
- 含歧义和冲突样本

每次评估保留原始输出、Schema 解析结果、Review findings、token、延迟和错误。
