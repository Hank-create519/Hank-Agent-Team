# Hank Agent Team v3 架构说明

> 版本：v3.0.0-dev　状态：可用（demo 端到端已测；legacy 引擎保留可回退）

## 1. 为什么改：固定流水线的三个问题

v2.2.1 的编排是一个约 600 行的单体函数 `startPipeline`，内含三条写死分支（简单/动态/兜底）：

1. **"动态路径"不动态**：`validatePlan` 强制计划必须包含 6 个固定阶段且顺序固定，规划器只能调顺序；
2. **两条路径两套语义**：动态路径第一次打回就抛错、兜底路径才计数重试；门禁判断在两处各写一遍；
3. **审查写死**：固定三层、固定三名审查员、固定触发点、固定轮次策略，"分歧度加轮"实际只能提前结束。

v3 的目标是：**流程是数据（TaskGraph），执行是通用运行时（GraphRuntime），审查是策略（ReviewPolicy），所有调用收敛到一个入口（invoke），交付判定只有一个出口（门禁）。**

## 2. 核心概念

| 概念 | 职责 | 代码 |
|---|---|---|
| Capability（能力） | 能做什么：`plan / extract / research / draft / review / verify / deliver` | `src/core/v3/graph.ts` 的 `CAPABILITY_META`、`src/core/v3/types.ts` |
| TaskGraph（任务图） | 这次任务怎么走：节点 + 依赖 + 门禁 + 有界返工 | `src/core/v3/types.ts`、`src/core/v3/graph.ts` |
| GraphGuard | 执行前确定性校验：未知能力/未知策略/缺门禁/反向依赖/风险等级不达标 → 拒绝 | `src/core/v3/graph.ts` `validateGraph` |
| GraphRuntime | 拓扑调度：并发组、有界返工、暂停/中止、门禁失败交人工 | `src/core/v3/runtime.ts` `runGraph` |
| ReviewPolicy | 审多深、谁来审、怎么判：`quick / standard / panel`（可扩展） | `src/core/v3/review.ts` `REVIEW_POLICIES` |
| invoke | 所有 LLM 调用的唯一入口：预算 → demo/live → 主进程网关 → auditId | `src/core/v3/invoke.ts`、`src/core/llm.ts` |
| 门禁 | 只能通过 `gate.required` 节点继续；交付节点必须依赖审查门禁 | `src/core/v3/runtime.ts` + `validateGraph` |
| 来源语义 | `live / demo / failed` 逐条标记；demo 不得通过 live 门禁 | `types.ts` `StageOutput.source`、审查服务的 `degraded` |

## 3. 一次任务的生命周期

```
startPipeline(userInput)
  ├─ beginTask：重置状态、判定 runMode（有 Key=live，否则 demo）
  ├─ 难度评估（assessDifficulty：LLM 判定 + 关键词兜底；demo 下复杂档降为中等档）
  ├─ 规划：chooseGraph(goal, difficulty) → TaskGraph（启发式：按代码/研究/安全信号增删节点）
  ├─ GraphGuard：validateGraph 不通过 → 直接报错，不执行（不静默降级安全）
  ├─ GraphRuntime：
  │    每个非 review 节点 → executeV3Node → runStage（复用旧阶段执行器与 UI 状态）
  │    每个 review 节点    → executeV3ReviewNode → runReview（策略化审查）
  │    每个 verify 节点    → executeV3VerifyNode（确定性检查）
  │    门禁失败 → 有界返工（最多 3 次）→ 仍失败 → 暂停等人工（恢复=风险自负，留痕）
  ├─ 交付：deliver 节点汇总（runStage('done')）
  └─ finally：isRunning=false，落盘事件
```

### 默认任务图（可被启发式规划器替换/扩展）

| 难度 | 节点序列（含可选节点） |
|---|---|
| simple | draft → review(quick) → deliver |
| medium | plan → review(standard) → extract → review(quick) → [research] → draft → [verify] → review(standard) → deliver |
| complex | plan → review(panel) → extract → review(standard) → research → draft → review(panel) → verify → [security review] → deliver |

> 节点是否出现由输入信号决定（代码/研究/安全关键词），这是"可审计的确定性规划"——同样输入得到同样的图。后续可把 `chooseGraph` 替换为 LLM 规划器，但输出必须通过同一个 `GraphGuard`。

## 4. 审查策略（取代固定三层）

| 策略 | 准备层 | 审查员 | 共识 | 轮次 | 用途 |
|---|---|---|---|---|---|
| `quick` | 无 | 逻辑 1 人 | single | 1 | 低风险、代码快审 |
| `standard` | 正向提取 | 逻辑 + 事实 | quorum | 1—2 | 中风险、方案/代码审查 |
| `panel` | 正反提取 + 轮次判定 | 逻辑 + 事实 + 用户 | divergence（分歧>阈值加轮） | 1—3 | 高风险、复杂任务 |

保留的诚实规则：

1. 任一调用降级（demo/failed）→ 裁决最高 `conditional`，且 `degraded=true`（不得作为真实通过依据）；
2. live 任务中 demo 来源的审查结果不得通过门禁；
3. 裁决 JSON 解析不到 → default-deny（不猜"通过"）；
4. 高风险 finding → 不得 `pass`；
5. 轮次/返工超限 → 暂停等人工，不自动放行。

### 扩展一个审查员（不改引擎）

1. 在 `src/core/Pipeline.ts` 的 `createAgents()` 里加一个 `role: 'reviewer_security'` 的 Agent（能力/模型/skills 配置）；
2. 在 `src/core/v3/review.ts` 的 `REVIEW_POLICIES` 里给某个策略的 `panel` 加一项；
3. 需要新提示词时在 `REVIEWER_PROMPTS` 里加一条。
> 注意：`Agent['role']` 目前是联合类型，新增角色需要同步扩展该类型（一处即可）。

## 5. 统一调用 invoke 与密钥边界

- 渲染层 **没有任何 HTTP 客户端**（v2 的 491 行直连协议已删除）；
- `invokeLLM` 决定 demo / live：demo 返回 fixtures；live 转发到 `window.electronAPI.llmCall`；
- 主进程 `electron/llm-gateway.cjs` 是唯一真实调用点：`agentId → safeStorage 密钥 → provider 路由 → 超时/重试 → 工具循环 → 审计`；
- 渲染层不再传 `baseUrl`（避免把密钥发往任意地址），端点由主进程按 provider 解析；
- 每次调用返回 `auditId`，供门禁与人工复核引用。

## 6. 与 legacy 引擎的关系（回退策略）

- 默认 `engineMode = 'v3'`；
- `setEngineMode('legacy')` 可切回 v2.2.1 的固定流水线（保留一版用于对比/回滚）；
- 两个引擎共用同一个 `PipelineState` 与 UI，迁移期 UI 无感；
- legacy 保留的时间点：确认 v3 在真实模型下稳定 + 评测数据出来后，再删除 legacy（预计 v3.1）。

## 7. 门禁不变量（重构期间不得破坏）

| 编号 | 不变量 | 实现 |
|---|---|---|
| I1 | 单一路径：所有 LLM/工具调用只经 invoke/主进程网关 | 渲染层无 fetch；`llm.ts` 只做转发 |
| I2 | 门禁不可绕过：交付必须依赖审查门禁 | GraphGuard + Runtime 双重检查 |
| I3 | 来源语义：live/demo/failed 逐条标记 | `StageOutput.source`、审查 `degraded` |
| I4 | 有界：节点/轮次/返工/调用预算 | `MAX_NODES`、`maxIterations≤3`、`_v3Budget` |
| I5 | 可审计：调用/门禁/人工干预留痕 | `recordMonitorEvent` + 主进程 audit JSONL |
| I6 | 可回退 | `setEngineMode('legacy')` |
| I7 | 人可接管：超限/驳回 → 暂停等人工 | `handleV3GateFailure` + `waitIfPaused` |

## 8. 后续演进

- **LLM 规划器**：`chooseGraph` 可替换为 invoke('plan_graph')，输出过 GraphGuard；当前启发式规划已能按信号增删节点；
- **可审计协作板（Board）**：事件日志（TaskEvent）已具备骨架，可将设计文档中的威胁模型/信任层落地；
- **评测体系**：用 `verify` + 审查策略跑 20—100 个带已知缺陷的任务集，产出拦截率/误报率；
- **具身迁移**：新增 `robot_action_gate` 能力（动作 schema + 关节限位/速度/工作空间检查 + 仿真接口），复用同一套门禁与审计。


---

## 9. v3.1 增补（第一批技术升级）

### 9.1 统一调用（invokeLLM 唯一实现）

```ts
invokeLLM({
  context: { taskId, nodeId, capability, attempt },
  agent, models,
  stage, systemPrompt?, userPrompt,
  demo, signal?,
  budget?: InvokeBudget,        // 任务级 + 节点级
  retry?: { max },              // 可重试错误（超时/429/5xx）
})
→ { status, content, auditId, auditIds, retryCount, provider, model, agentId, context, error? }
```

- plan/extract/research/draft/deliver/review 全部经由它；legacy `callLLM` 只是适配器；
- 失败分类：`no-key / budget-exceeded / budget-node-exceeded / http-error / empty-response / aborted / unknown`；
- 调用上下文与 auditId 进入主进程审计，可定位到节点与第几次尝试。

### 9.2 端点安全边界

- Renderer **不发送 baseUrl**；主进程 `resolveEndpoint(provider)` 为唯一端点事实源；
- 未知 Provider / 未配置端点厂商 → 明确失败，禁止静默回退 OpenAI；
- 携带 baseUrl 的 IPC 调用被拒绝（审计 `llm-call-rejected`），不发起网络请求。

### 9.3 AgentRouter 选人

选择顺序（确定性评分）：同部门 → 角色偏好（按序加权）→ 空闲 → 已配 Key → 低负载 → 低失败率 → 低平均耗时 → tie-breaker（agentId 字典序）。
本部门无可用 Key → 跨部门代办，返回 `crossDepartment`，引擎写 `agent_route` 审计事件。
职责约定：队长负责规划/汇总/复核，成员负责执行；审查按策略 `preferredRoles` 选人。

### 9.4 节点级输出与审计

```ts
nodeOutputs[nodeId] = {
  nodeId, capability, title, status, content, summary,
  auditIds, gate?, agentId?, provider?, model?, attempt, createdAt
}
```

- 业务事实源：交付汇总、审查兼容、审计事件、回放都以 nodeOutputs 为准；
- `stageOutputs` 只做旧 UI 兼容映射（research 不覆盖 extract）；
- 无外呼节点（verify / 演示审查）使用 `local_*` 本地审计 ID（不与主进程 auditId 混淆）；
- 预算：任务级 240 次 / 节点级 40 次；超限即中止任务。

### 9.5 失败与门禁语义（运行时）

| 情形 | 行为 |
|---|---|
| 非门禁节点 failed | 中止任务，不向下游传播 |
| `onFail=abort` 且门禁未通过 | 立即中止（不允许人工继续绕过） |
| `onFail=rework` | 必须有 loop；有界返工，超过阈值 → onGateFailure |
| `onFail=pause` | 暂停等人工；恢复需留痕 |
| `degraded`（demo/失败） | 裁决最高 conditional；live 门禁不接受 demo 来源 |

### 9.6 GraphGuard 新增规则

required gate 必须是交付祖先；loop.target 不能是 review/deliver；rework 必须带 loop；深度 ≤12；预计调用 ≤40；高风险必须 panel + verify 门禁且在交付依赖链上。

### 9.7 下一批（v3.2/v3.3）

任务类型专用 verify（文档/代码/研究/表格/决策）→ 缓存去重 → 模型分层/成本 → 协作板/回放 → 真实模型评测 → 移除 legacy（v4）。

---

## 10. v3.2 增补（P0 加固与可靠性）

### 10.1 真实可判定的 verify

`src/core/v3/verify.ts` 提供确定性校验器：`nonempty`（长度阈值）、`strict-json`（严格 JSON.parse + 顶层 object + expectedKeys 最小 schema）、`live-source`（live 任务拒绝 demo 上游）、未知校验项 default-deny。
代码类任务的编译/测试/lint 属“真实验证器”，需受控沙箱与独立威胁模型，列入 v3.3；当前模板只对代码任务做 nonempty/live-source，不对代码文本做伪 JSON 检查。

### 10.2 ContextBuilder（上下文预算）

`src/core/v3/context.ts`：
- 每个能力有 token 预算（`CAPABILITY_META.contextTokens`）；
- 来源按优先级（用户目标 100 > 门禁通过产出 60 > 普通产出 30 > 交付摘要 45/25）装配；
- 单来源份额上限（默认 0.65），超预算按“头 70% + 尾 30%”码点安全截断；
- 内容去重；截断原因写入 `nodeOutputs.contextInfo` 与 `context_truncated` 审计事件。
目的：长任务/检索/返工时 Prompt 不再无界膨胀，成本与质量可解释。

### 10.3 图预算（按 ReviewPolicy 成本）

`ReviewPolicy.maxCalls`（quick 3 / standard 7 / panel 12）暴露单次审查最坏调用数；
`estimateGraphCalls(graph)` = Σ 节点成本 + Σ 返工次数 ×（目标成本 + 复审成本）。
GraphGuard 上限 160（任务总预算 240，为运行时重试/人工预留）。取代原先“节点数+循环数”的严重低估。

### 10.4 IPC payload 校验（主进程边界）

`validatePayload(payload)`：agentId/provider/model 非空+长度、provider allowlist、dept/stage 枚举、Prompt 长度上限、session/task/node/request id 格式、attempt 整数范围。
非法请求返回 failed + 审计 `llm-call-rejected`（reason=payload-invalid），不发起网络请求。导出纯函数供契约测试。

### 10.5 主进程 auditId 与真实取消

- 网关为每次调用生成 `aud_*`，写入审计并随响应返回；Renderer 以主进程 ID 为准。
- 网关登记 requestId→AbortController；新增 `llm-cancel` IPC（按 taskId 中止在途请求）；Renderer `stop()` 触发取消，`fetchWithRetry` 使用外部 signal 合并超时信号。

### 10.6 预检与故障切换

- `preflightLiveMode()`：启动前生成「能力→部门→可用 Agent」矩阵（Key/模型注册/provider 端点），live 不满足即 fail-closed。
- 故障切换梯度：可重试错误 → 备用 Agent（≤3 候选）→ 跨部门（Router 允许时留痕）→ 人工；认证/端点错误不自动重试；预算超限中止任务。

### 10.7 路由与统计

- 公平性：闲置越久（含从未使用）加分；`maxConcurrent` 容量约束；EMA 失败率/耗时参与评分。
- 执行后统一更新 Agent 统计（tasksCompleted/errors/avgTime 移动平均），Router 记录 EMA。

### 10.8 发布门槛

`npm run check` = typecheck + ESLint（0 warning）+ 142 tests + build；主进程 CJS 语法检查；`.nvmrc`/`engines` 锁定 Node ≥20。
