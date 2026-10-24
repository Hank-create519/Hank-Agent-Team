# CHANGELOG：v2.2.1 → v3.0.0-dev

> 原则：先修"声称的功能"，再改架构，最后删冗余。每个阶段都有测试与验收。

## 一、P0 修复（让 v2.2.1 真的能运行）

| # | 问题 | 修复 |
|---|---|---|
| 1 | 中等/复杂任务在 `audit_entry` 因 TDZ 崩溃（`Cannot access 'rfState' before initialization`） | `Engine.ts` 审查回调不再读取未初始化的解构变量；补集成测试 |
| 2 | V2.2 密钥迁移后 `agent.apiKey` 恒为空，审查框架永远走 mock、难度永远关键词 | 统一 `hasKey`：主进程新增 `secrets-has` IPC；`ReviewFramework`/`difficultyRouter` 改用 `hasKey`；启动时同步 `hasKey` |
| 3 | 深度审计连续不通过仍会 deploy/done（门禁被绕过） | 循环结束后检查 `codeApproved`，未通过 → 暂停等人工（legacy 路径）；v3 由 GraphGuard + Runtime 门禁保证 |
| 4 | 桌面端无 Key 不会 demo，而是首个阶段暂停（与 README 不符） | `callLLM` 增加 demo 选项：demo 模式走 fixtures 并标记 `demo`；live 模式失败才暂停 |
| 5 | 密钥迁移失败仍写 `done` 标记，明文可能留在 localStorage | 仅在全部成功时写标记；失败下次重试；新增 `syncHasKeyToAgents` |
| 6 | 默认 Agent 使用腾讯混元，但混元无默认端点（5 个模型必然失败） | 默认 Agent 改为有默认端点的 DeepSeek 模型；未知 provider 明确失败 |
| 7 | 演示模式下复杂任务必卡在深度审计 | demo 模式复杂档自动按中等档执行（真实模型下仍按复杂档） |
| 8 | Git 面板与主进程 `exec` 契约不一致（必然报错），且工作区功能未接线 | 移除未完成的 Git 面板与 `exec`/`workspaces` IPC（README 已同步说明） |

## 二、架构升级：固定流水线 → 能力图编排

新增 `src/core/v3/`：

| 文件 | 作用 |
|---|---|
| `types.ts` | 能力/任务图/门禁/审查策略契约 |
| `invoke.ts` | 统一 LLM 调用入口（demo / 主进程网关），带预算与 auditId |
| `graph.ts` | 能力元数据、三张默认图、按输入信号的启发式规划、GraphGuard 校验 |
| `runtime.ts` | 通用图运行时：拓扑执行、并发组、有界返工、门禁失败交人工 |
| `review.ts` | 策略化审查服务：quick / standard / panel，审查员与轮次可配置 |

- `Engine.ts` 默认走 v3（`startPipelineV3`），保留 `startPipelineLegacy` 与 `setEngineMode('legacy')` 回退；
- UI 无感：两个引擎共用 `PipelineState`，审查结果兼容旧 ReviewDetail 数据结构；
- 新增确定性校验能力 `verify`（非空、结构化 JSON、来源一致性），可作为门禁。

## 三、删除的冗余（单一事实源）

| 删除项 | 行数 | 原因 |
|---|---:|---|
| `src/core/llm.ts` 渲染层直连三协议 + 工具循环 | ~491 | 两种运行模式下都不可达；真实调用只在主进程网关 |
| `src/core/safetyGuard.ts` 整文件 | ~249 | 只被已死的工具循环调用；工具策略已单一化到主进程 |
| `src/core/Communication.ts` | ~62 | 总线只写不读（装饰层），消息已由 `PipelineState.messages` + 事件日志承担 |
| 5 个零引用 UI 组件（StatusBar/ExecutionPanel/InputPanel/ResultPanel/StartupScreen） | ~1,052 | 无任何 import |
| `GitPanel.tsx` + `workspaces.cjs` + 相关 IPC | ~300 | 契约不一致且未接线 |
| `ReviewEngine` 类/单例、`computeTaskSuccess`、`filterMonitorEvents`、`getSkill`、死 mock 函数、Pipeline 死 helper、appStore 死 action | ~200 | 零引用 |
| `framer-motion`、`react-router-dom` 依赖 | — | 组件删除后无引用 |

> 同时把重复实现收敛为单一事实源：审核结论解析（`utils/review-parse.ts`）、审查报告格式、阶段/能力元数据等。

## 四、测试

| 项 | v2.2.1 | v3.0.0-dev |
|---|---|---|
| 测试文件 | 2 | 6 |
| 测试用例 | 37 | **71** |
| 覆盖 | 纯函数 | 纯函数 + GraphGuard + 图运行时 + 审查策略 + v3 端到端（demo） |
| 命令 | `npm test` | `npm run check`（typecheck + test + build） |

## 五、已知问题（下一步）

- 主进程 `electron/*.cjs` 尚未纳入类型检查（建议迁 TS 或 `// @ts-check`）；
- 真实模型下的端到端与评测数据尚未产出（接口已就绪）；
- legacy 引擎计划在 v3.1 删除（需先补真实模型对比测试）；
- `docs/design/` 中的"可审计协作板"仍为设计稿，未实现。

## 六、复现验证

```bash
npm ci            # 若卡在 Electron 二进制：ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run check     # typecheck + 71 tests + build
npm start         # 桌面端（无 Key 时为 demo 模式）
```

---

# v3.0.0-dev → v3.1.0-dev（技术升级第一批：四项优先）

> 对应《技术升级方案》的四个优先项：统一 invokeLLM、移除 Renderer baseUrl、引入 AgentRouter、节点级输出/审计；并同步加固 GraphGuard 与运行时失败语义。

## 一、统一调用入口（invokeLLM 唯一实现）

- `src/core/v3/invoke.ts` 成为**唯一** LLM 调用实现：上下文（taskId/nodeId/attempt）、auditId、预算（任务级 + 节点级）、重试、demo/live/failed 三态、provider/model 全部统一；
- legacy `callLLM` 改为 invoke 适配器（`llm.ts` 仅剩类型转换 + `safeJsonParse` re-export），不再有第二套桥接/协议逻辑；
- plan/extract/research/draft/deliver 不再经过 `runStage → callLLM`，统一走 `runCapabilityInvoke → invokeLLM`；难度评估仍经适配器（legacy 入口），行为一致；
- `safeJsonParse` 迁至 `src/core/utils/json.ts`（单一实现）。

## 二、安全边界：Renderer 不能控制真实模型端点

- 主进程网关新增 `resolveEndpoint(provider)`：**未知 Provider / 未配置端点的厂商明确失败**，不再静默回退到 OpenAI；
- `llm-gateway.callLLM` 明确拒绝携带 `baseUrl` 的调用（返回 failed + 审计 `llm-call-rejected`），不发起任何网络请求；
- 渲染层 `invokeLLM` 不向主进程发送 baseUrl；`AgentsPanel` 删除 Base URL 输入框，改为"端点由主进程统一解析"提示；
- `llm-test` 连接测试也不再接受 baseUrl；
- 网关审计记录补充 `taskId/nodeId/attempt`，可追溯到节点级。

## 三、AgentRouter：部门/角色/负载/Key 的统一选人

- 新增 `src/core/v3/agentRouter.ts`：
  - 同部门优先、角色偏好按序加权（执行交给成员、规划/汇总交给队长）；
  - 空闲/低负载/低失败率/低平均耗时优先；显式确定性 tie-breaker（agentId 字典序）；
  - 本部门无可用 Key 时才跨部门代办，并返回 `crossDepartment` 由引擎写审计事件；
  - 运行时维护 inFlight / lastUsed，任务结束可 reset；
- 引擎 v3 的能力调用与审查服务选人均改走 AgentRouter（审查按 `preferredRoles` 选逻辑/事实/用户审查员）；
- legacy 固定流水线保留 `pickAgent`（v4 删除 legacy 时一并移除）。

## 四、节点级输出与审计（nodeOutputs 为业务事实源）

- `PipelineState.nodeOutputs`：每个节点产出 `{nodeId, capability, status, content, summary, auditIds, gate, agentId, provider, model, attempt, createdAt}`；
- `stageOutputs` 仅保留给旧 UI 兼容（按能力映射到旧阶段；`research` 不再覆盖 `extract`）；
- 交付汇总、审查兼容视图、审计事件 `node_output` 都改为读节点级产出；
- 确定性节点（verify）与演示审查没有外呼，也会生成 `local_*` 本地审计 ID，保证每个节点可追溯（`local_*` 表示无外呼的本地判定，不与主进程 auditId 混淆）；
- 预算：任务级 240 次 + 节点级 40 次，超限即中止任务（不再无限重试）；
- 失败语义：非门禁节点失败 → 中止任务、不向下游传播；`onFail=abort` → 真正中止，不允许人工继续绕过；`onFail=rework` 必须带 loop。

## 五、GraphGuard 加固（新增规则）

1. 所有 `gate.required` 审查节点必须是交付节点的**祖先依赖**（不只是直接输入）；
2. `loop.target` 不能指向 review / deliver 节点；
3. `onFail=rework` 必须配置 loop；
4. 图深度 ≤ 12、预计调用次数（节点数 + 返工上限）≤ 40；
5. 高风险任务必须同时具备 **panel 审查门禁 + verify 门禁**，且 verify 门禁在交付依赖链上；
6. 保留原有：未知能力/未知策略/重复 id/反向依赖/节点数上限/循环上限。

## 六、测试

| 项 | v3.0.0-dev | v3.1.0-dev |
|---|---|---|
| 测试文件 | 6 | 9 |
| 测试用例 | 71 | **110** |
| 新增覆盖 | — | AgentRouter 选人/负载/跨部门回退；invoke 统一语义（预算/重试/baseUrl 不发送/中止）；网关契约（baseUrl 拒绝、Provider 端点、审计上下文）；GraphGuard v3.1 规则；运行时失败传播与 abort；节点级输出/审计；审查 JSON Schema（category/evidence/recommendation） |

验证：`tsc --noEmit` 通过；`vitest run` 9 文件 / 110 用例全过；`vite build` 通过；主进程 CJS 语法检查通过。

## 七、仍未完成（下一批 v3.2/v3.3）

- 任务类型专用 verify（文档/代码/研究/表格/决策的不同检查项；代码编译与测试需受控沙箱）；
- 缓存与去重（按 goal+input+policy+model hash，时间敏感任务不缓存）；
- 模型分层（ModelConfig 已预留 tier/supportsTools 等字段）与成本估算；
- 审计协作板/回放、真实模型评测集（拦截率/误报率）；
- Electron E2E 与 CI 中的主进程契约测试接入。

---

# v3.1.0-dev → v3.2.0-dev（P0 加固 + 可靠性升级 + 发布治理）

> 依据 v3.1 源码审查结论：先关闭 P0（门禁依赖、审计顺序、伪 JSON 校验、预算低估、上下文失控、IPC 缺校验），再补高价值 P1（路由公平性、故障切换、预检、取消、统计、工具会话治理），并把 lint/check 纳入发布门槛。
> 本次**未做**：部门 Artifact 合同重构、办公工具接入（文件/表格/测试/Git）、真实 Provider E2E——按路线放入 v3.3。

## 一、P0 修复

| # | 问题 | 修复 |
|---|---|---|
| P0-1 | 中等代码任务的 verify 节点不是交付依赖（图语义不保证执行/门禁） | 模板把 verify 加入 deliver.inputs；GraphGuard 强制**所有 required verify 门禁都必须是交付祖先**（不限高风险） |
| P0-2 | 门禁 default-deny 在 onNodeDone 之后才补，节点产出/审计缺少实际拒绝结论 | 运行时先标准化 `result.gate`（缺门禁 → default-deny reject + degraded），再调用 onNodeDone；新增测试断言 |
| P0-3 | `result-json` 只检查文本含 `{}`，代码片段/普通文本误判通过 | 新增 `src/core/v3/verify.ts`：`strict-json` 严格 `JSON.parse` + 顶层 object + `expectedKeys` 最小 schema；未知校验项 default-deny；模板不再对代码任务做 JSON 检查 |
| P0-4 | 图预算按"节点数+循环数"，严重低估 panel 审查成本 | `ReviewPolicy.maxCalls`（quick 3 / standard 7 / panel 12）；`estimateGraphCalls()` 按能力+策略+返工计算最坏情况；GraphGuard 上限 160，运行时任务预算 240 |
| P0-5 | draft/deliver 直接拼接上游输出，Prompt 无上限 | 新增 `src/core/v3/context.ts` ContextBuilder：按能力 token 预算（plan 1200 / extract 1800 / draft 2600 / deliver 2000…）、来源优先级、单来源份额、头尾码点安全截断、去重；截断记录写入 `nodeOutputs.contextInfo` + `context_truncated` 审计事件 |
| P0-6 | IPC 网关只拒绝 baseUrl，其余 payload 无校验 | 主进程 `validatePayload`：agentId/provider/model 非空+长度、provider allowlist（未知/未配置明确拒绝）、部门/stage 枚举、Prompt 长度上限（system 20k/user 100k）、session/task/node/request id、attempt 范围；非法请求 failed + `llm-call-rejected` 审计，且不触网 |

## 二、高价值 P1

- **路由公平性修正**：闲置越久（含从未使用）加分而非扣分；`maxConcurrent` 容量约束；EMA 失败率/耗时参与打分。
- **故障切换梯度**：可重试错误 → 同部门/备用 Agent（最多 3 个候选）→ 跨部门（Router 允许时，留痕）→ 人工；认证/端点/参数错误不自动重试；预算超限直接中止任务。
- **live 预检 fail-closed**：启动前生成「能力→部门→可用 Agent」矩阵，检查 Key/模型注册/provider 端点；不满足则禁止以 live 启动（明确报错），demo 不受影响。
- **难度评估迁移**：`assessDifficulty` 改走 `invokeLLM`，纳入任务/节点预算与审计上下文（demo 走关键词兜底）。
- **真实取消**：主进程登记在途请求（requestId→AbortController），新增 `llm-cancel` IPC；Renderer `stop()` 触发按 taskId 取消，网关在请求层中止。
- **主进程 auditId**：网关生成 `aud_*` 并写入审计、随响应回传；Renderer 侧以主进程 ID 为准（可回查 audit-log.jsonl）。
- **Agent 统计写入**：执行完成后统一更新 `tasksCompleted/errors/avgTime`（移动平均）+ Router EMA，历史表现不再"只读不写"。
- **审查轮次升级策略**：`escalation.onRoundLimit='reject'` 真正生效（轮次耗尽仍不通过 → 明确 reject）；`pause` 保持引擎暂停语义。
- **工具会话治理**：会话计数 Map 增加 TTL（10 分钟）与上限淘汰（200 会话），避免长期运行残留。
- **持久化迁移**：`localStorage` 旧配置中清理已废弃 `baseUrl` 字段，补齐 `hasKey/maxConcurrent`。
- **发布治理**：ESLint 清零（0 error / 0 warning，含主进程脚本）；`npm run check` = typecheck + lint + test + build；postcss/tailwind 配置改 `.cjs` 消除模块类型告警；新增 `engines` 与 `.nvmrc`。

## 三、测试

| 项 | v3.1.0-dev | v3.2.0-dev |
|---|---|---|
| 测试文件 | 9 | **11** |
| 测试用例 | 110 | **142** |
| 新增覆盖 | — | 严格 JSON/schema verify、ContextBuilder 预算/截断/去重、图预算估算（ReviewPolicy.maxCalls）、verify 门禁祖先、default-deny 审计顺序、Router 公平性/容量/EMA、live 预检矩阵、IPC payload 校验、主进程 auditId、按 taskId 取消、持久化迁移字段清理 |

验证：`npm run check` 全绿（typecheck + lint 0 warning + 142 tests + build）；主进程 CJS 语法检查通过。

## 四、仍未完成（下一批 v3.3）

1. 部门「工作合同」Artifact 数据模型（producer/kind/quality/provenance/citations）与跨部门收紧规则；
2. 任务类型专用 verify + 受控沙箱（代码编译/测试/lint、文档结构、表格公式、研究来源评级）；
3. 办公工具接入（受限文件读写、表格/文档生成、Git 工作区、审批流）；
4. 缓存去重、模型分层（质量/成本/速度/保密策略）、成本估算；
5. 审计协作板/回放、真实 Provider E2E（两厂商 × 四部门 × 四类任务）、Electron E2E；
6. 移除 legacy 固定流水线（v4，真实回归达标后）。
