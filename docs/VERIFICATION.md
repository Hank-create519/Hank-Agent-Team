# v3.2.0-dev 验证记录（2026-10-21）

环境：macOS · Node v24（Electron 二进制未下载，仅验证纯 JS/TS 层）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 通过（0 error） |
| ESLint | `npm run lint` | ✅ 0 error / 0 warning（含 electron-main.js/preload.js） |
| 测试 | `npm test` | ✅ **11 个测试文件 / 142 个用例全部通过** |
| 渲染层构建 | `npm run build` | ✅ 通过 |
| 一键发布门槛 | `npm run check` | ✅ typecheck + lint + test + build 全绿 |
| Electron 主进程语法 | `node --check electron-main.js preload.js electron/*.cjs` | ✅ 全部通过 |
| demo 端到端 | `engine-v3.test.ts` | ✅ 简单/中等/复杂→中等 到 `done`；节点级输出/上下文预算/审计字段齐全 |
| 网关安全边界 | `gateway.contract.test.ts` | ✅ baseUrl 拒绝且不触网；未知/未配置 Provider 明确失败；payload 校验拒绝超长/非法枚举；主进程 auditId 可回查；按 taskId 取消生效 |

## 测试清单（11 文件 / 142 用例）

| 文件 | 覆盖 |
|---|---|
| `core/__tests__/gates.test.ts` | 门禁解析、计划校验、任务终态、码点安全截断 |
| `core/__tests__/v22.test.ts` | 工具策略、审计、聊天意图 |
| `core/__tests__/engine-v3.test.ts` | v3 demo 端到端；节点级输出/审计；上下文预算；live 预检矩阵 |
| `core/v3/__tests__/graph.test.ts` | GraphGuard 合法/非法图；v3.1 规则；v3.2 verify 祖先、ReviewPolicy 预算估算、默认并发组 |
| `core/v3/__tests__/runtime.test.ts` | 拓扑/并发/返工/人工接管/中止/失败传播/attempt；default-deny 审计顺序 |
| `core/v3/__tests__/review.test.ts` | quick/standard/panel、降级、default-deny、高风险阻断、JSON Schema |
| `core/v3/__tests__/agentRouter.test.ts` | 选人、负载、失败率、跨部门、tie-breaker、公平性、容量、EMA |
| `core/v3/__tests__/invoke.test.ts` | 统一调用语义、预算、重试、baseUrl 不发送、中止 |
| `core/v3/__tests__/gateway.contract.test.ts` | baseUrl 拒绝、Provider 端点、payload 校验、主进程 auditId、取消 |
| `core/v3/__tests__/verify.test.ts` | 严格 JSON/schema、live-source、未知校验项 default-deny |
| `core/v3/__tests__/context.test.ts` | token 估算、预算截断、单来源份额、去重、码点安全 |

## 未验证（需真实环境）

- 真实模型 API 调用（需要 Electron 主进程 + 有效 Key；live 预检只验证配置矩阵，不验证网络可达）
- Electron 真机启动与 UI 交互
- 工具循环的真实网络搜索
- 真实模型下的端到端质量与评测（拦截率/误报率/成本）
- 代码编译/测试类真实验证器（受控沙箱未实现，属 v3.3）
