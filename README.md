<div align="center">

# Hank Agent Team v3.2

**可信多 Agent 协作流水线 —— 能力图编排 · 统一调用 · 策略化审查 · 节点级审计**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-28-47848F)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/tests-142%20passing-brightgreen)](#测试)

</div>

---

## 这是什么

Hank Agent Team 是一个本地运行的桌面多 Agent 协作流水线。它要解决的不是"再做一个 AI 聊天框"，而是三个工程问题：

- **结果可信**：真实调用失败时暂停等待处理，绝不用演示数据伪造成功；
- **过程可审计**：每次调用、每次门禁、每次人工干预都有记录，可回放；
- **门禁不可绕过**：交付前必须通过审查与确定性校验，且演示产出永远不能算作真实通过。

v3.2 在 v3.1 基础上完成 P0 加固与可靠性升级：**真实可判定的 verify（严格 JSON/schema）、受预算约束的 ContextBuilder、按 ReviewPolicy.maxCalls 的图预算估算、主进程 IPC payload 校验、主进程 auditId 与真实取消、live 预检 fail-closed、故障切换梯度、Router 公平性/容量/EMA、ESLint 清零并纳入 check 门槛**。架构主线不变：**流程**由任务图（TaskGraph）决定，**审查**由策略（ReviewPolicy）决定，**选人**由 AgentRouter 统一（队长规划/汇总、成员执行、跨部门代办留痕），**所有模型调用**收敛到唯一 `invokeLLM` 入口，**节点级输出/审计**（nodeOutputs）成为业务事实源，Renderer 不再能指定任何模型端点。

---

## v3 架构（一页看懂）

```
Planner（启发式/可替换为 LLM）→ TaskGraph → GraphGuard（确定性校验）→ GraphRuntime（调度）
                                                    │
        能力：plan / extract / research / draft / review / verify / deliver（注册表，可扩展）
                                                    │
        审查：quick / standard / panel / security（策略，可配置审查员与轮次）
                                                    │
        invoke()：唯一调用入口 → AgentRouter → PromptBuilder → 主进程网关（密钥/协议/工具）
                                                    │
        门禁：assertCanDeliver（单点判定，任何路径都绕不过）
```

- **能力注册表**：加一种能力 = 加一条定义与提示词，不改引擎；`src/core/v3/graph.ts`（能力元数据）、`src/core/v3/types.ts`
- **动态任务图**：`src/core/v3/graph.ts`（模板/启发式规划）、`src/core/v3/runtime.ts`（拓扑执行、并发组、有界返工、门禁）
- **策略化审查**：`src/core/v3/review.ts`（quick 单审 / standard 双审 / panel 三审 + 分歧加轮；审查员可增删）
- **统一调用**：`src/core/v3/invoke.ts`（唯一实现；上下文 taskId/nodeId/attempt、auditId、任务级+节点级预算、重试；真实 HTTP 只在主进程网关）
- **选人路由**：`src/core/v3/agentRouter.ts`（部门/角色/空闲/失败率/平均耗时 + 跨部门回退留痕）
- **节点级输出**：`nodeOutputs` 为业务事实源（含 auditIds/gate/agent/provider/model/attempt）；`stageOutputs` 仅旧 UI 兼容
- **兼容旧引擎**：`setEngineMode('legacy')` 可回退到 v2 的固定流水线（保留一版用于对比/回滚）

---

## 诚实边界（当前不做什么）

- **不写文件、不改仓库、不执行部署**：开发部产出的是方案与代码文本，不会直接改动你的项目目录；
- **审查是 LLM 审查**：不能替代形式化验证；`verify` 只做非空、结构化 JSON、来源一致性等确定性检查；
- **无 API Key 时为演示模式**：所有产出标记 `demo`，终态为 `demo`，不计入真实成功；
- **真实调用失败会暂停**：点击"继续"重试，"停止"结束任务——不会自动降级冒充成功；
- **部分模型未配默认端点**（如腾讯混元、Meta）：调用会明确失败，可在 `electron/llm-gateway.cjs` 的 `DEFAULT_BASE_URL` 中补充后使用。

---

## 快速开始

```bash
npm ci                # 安装依赖（如卡在 Electron 二进制：ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci）
npm run typecheck     # TypeScript 类型检查
npm test              # 71 个测试（含 v3 图/审查/运行时/端到端）
npm run build         # 构建渲染层（dist/）
npm start             # 启动 Electron 桌面端
```

> 没有 API Key 也能完整跑演示流程：任务会走演示模式，产出全部标记 `demo`。
> 配置真实 Key 后，调用只发生在主进程网关中（渲染层拿不到密钥）。

---

## 测试

```bash
npm test
```

覆盖：

| 测试 | 内容 |
|---|---|
| `core/__tests__/gates.test.ts` | 门禁解析、计划校验、任务终态、码点安全截断 |
| `core/__tests__/v22.test.ts` | 主进程工具策略、审计、聊天意图路由 |
| `core/v3/__tests__/graph.test.ts` | GraphGuard：合法图通过；缺门禁/未知能力/未知策略/反向依赖等**非法图被拒绝** |
| `core/v3/__tests__/runtime.test.ts` | 拓扑执行、并行组、有界返工、人工接管、中止 |
| `core/v3/__tests__/review.test.ts` | quick/standard/panel 策略；降级最高 conditional；高风险问题不得 pass；解析失败 default-deny；审查 JSON Schema（category/evidence/recommendation） |
| `core/v3/__tests__/agentRouter.test.ts` | 部门/角色偏好、负载与失败率、跨部门回退、确定性 tie-breaker |
| `core/v3/__tests__/invoke.test.ts` | 统一调用语义：auditId/context、不发送 baseUrl、demo/live/failed、重试、任务级/节点级预算、中止 |
| `core/v3/__tests__/gateway.contract.test.ts` | 主进程契约：baseUrl 拒绝且不触网、Provider 端点解析、IPC payload 校验（超长/未知 provider/非法 dept/session/attempt）、主进程 auditId、按 taskId 取消 |
| `core/v3/__tests__/verify.test.ts` | 严格 JSON + expectedKeys schema、live-source、未知校验项 default-deny |
| `core/v3/__tests__/context.test.ts` | token 估算、预算截断、单来源份额、去重、码点安全 |
| `core/__tests__/engine-v3.test.ts` | demo 模式端到端（简单/中等/复杂→中等降级），任务到 done 且终态 demo |

---

## 安全机制

| 层级 | 机制 |
|---|---|
| 密钥 | 只在主进程 `safeStorage` 加密存储；渲染层只有 `hasKey`（布尔），拿不到明文 |
| 端点 | **Renderer 不能指定 baseUrl**：invoke 只发 agentId/provider/model；主进程解析厂商端点，未知/未配置厂商明确失败（不静默回退 OpenAI）；携带 baseUrl 的调用被拒绝并审计 |
| 工具 | 主进程 `electron/tool-runtime.cjs` 是唯一策略源：部门白名单 → 限流 → 参数校验 → 执行 → 结果清洗 → 审计；其余工具默认 disabled |
| 门禁 | 审查节点必须配置 `gate.required`；交付节点必须依赖审查门禁；GraphGuard 在执行前校验，运行时二次检查 |
| IPC | 主进程校验 payload：agentId/provider/model/部门/stage 枚举、Prompt 长度上限、session/task/node/request id 格式、attempt 范围；非法请求 failed + 审计拒绝 |
| 端点 | Renderer 不能指定 baseUrl；未知/未配置端点厂商明确失败，不静默回退 |
| 预检 | live 启动前生成「能力→部门→可用 Agent」矩阵（Key/模型/端点），不满足则 fail-closed 禁止启动 |
| 取消 | 主进程登记在途请求，按 taskId 真实中止（AbortController + IPC）；Renderer stop 不再是“假停止” |
| 审计 | **真实调用 auditId 由主进程生成并落盘**（任务/节点/尝试可追溯）；节点级 `nodeOutputs.auditIds`；确定性节点使用 `local_*` 本地审计 ID（明确语义，不与主进程 ID 混淆） |

---

## 项目结构

```
src/
├── core/
│   ├── Engine.ts              # 引擎入口：v3 任务图执行（默认）/ legacy 固定流水线（可回退）
│   ├── v3/
│   │   ├── types.ts           # 能力/任务图/门禁/审查策略契约
│   │   ├── invoke.ts          # 统一 LLM 调用入口（上下文/预算/重试/auditId；demo / 主进程网关）
│   │   ├── agentRouter.ts     # 选人路由（部门/角色/负载/Key/跨部门回退）
│   │   ├── graph.ts           # 能力元数据 + 模板/启发式规划 + GraphGuard
│   │   ├── runtime.ts         # 通用图运行时（拓扑/并发/返工/门禁）
│   │   └── review.ts          # 策略化审查服务（quick/standard/panel）
│   ├── utils/                 # review-parse（审核结论解析）、json（安全 JSON 解析，单一实现）
│   ├── llm.ts                 # 渲染层薄层（demo fixtures / 网关转发）
│   ├── difficultyRouter.ts    # 难度评估（LLM + 关键词兜底）
│   ├── ReviewFramework.ts     # legacy 三层审查（仅供 legacy 引擎）
│   ├── Pipeline.ts / types.ts / Monitor.ts / chatRouter.ts / skillRegistry.ts
├── ui/                        # React 界面（Dashboard / Pipeline / Review / Monitor / Agents）
└── store/appStore.ts
electron/
├── llm-gateway.cjs            # 唯一 LLM 网关：密钥解析 + 三协议 + 重试 + 工具循环
├── tool-runtime.cjs           # 工具运行时（策略/限流/校验/清洗/审计）
├── secrets.cjs / audit.cjs / electron-main.js / preload.js
docs/
├── ARCHITECTURE-v3.md         # v3 架构与迁移说明
├── CHANGELOG-v3.md            # v2.2.1 → v3 的修复/重构/删除清单
├── design/                    # 历史设计文档（威胁模型/协作板方案）
└── screenshots/
```

---

## 已知问题 / 下一步

- 主进程 JS（`electron/*.cjs`）尚未纳入类型检查（后续迁移 TS 或 `// @ts-check`）；
- 任务类型专用 verify（文档/代码/研究/表格/决策）与代码编译/测试沙箱尚未实现（需单独威胁模型，v3.3）；
- 缓存/去重、模型分层与成本估算尚未实现（v3.3）；
- 部门「工作合同」Artifact 数据模型尚未落地（v3.3 重构项）；
- 历史设计文档中的"可审计协作板（Board）"仍是方案，未实现；
- 尚无真实模型下的评测数据（拦截率/误报率）；v3 的 `verify` 与审查策略为测量打好了接口；
- 桌面端 E2E（Electron 真机）未纳入 CI；CI 目前覆盖 typecheck + 单测 + 构建。

---

## License

MIT © 2026 Hank
