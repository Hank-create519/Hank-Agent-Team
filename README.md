<div align="center">

<img src="build/app_screenshot.png" alt="Hank Agent Team" width="800" />

# Hank Agent Team

**AI 驱动的四部门协作流水线引擎**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff)](https://vitejs.dev/)
[![Electron](https://img.shields.io/badge/Electron-28-47848f)](https://www.electronjs.org/)

</div>

---

## 这是什么

Hank Agent Team 是一个桌面端 AI 团队模拟器——你把需求扔进去，四个 AI 部门（指挥部、信息部、开发部、审核部）自动分工协作，经历 8 个标准化阶段，最终交付可部署的成果。

不是 ChatBot 套壳。它模拟了真实软件团队的**分工、审查、打回、重试**机制。

---

## 四部门 · 八阶段

```
                            ┌─────── 用户需求 ───────┐
                            │                        │
                   ┌────────▼────────┐               │
                   │   ① 制定方案    │ ← 指挥部       │
                   └────────┬───────┘               │
                            │ 方案                   │
                   ┌────────▼────────┐               │
                   │   ② 审查把关    │ ← 审核部       │
                   └────────┬───────┘               │
                            │ 通过                   │
                   ┌────────▼────────┐               │
                   │   ③ 信息提取    │ ← 信息部       │
                   └────────┬───────┘               │
                            │                       │
                   ┌────────▼────────┐               │
         ┌─────────│   ④ 内容审核    │ ← 审核部       │
         │ 打回    └────────┬───────┘               │
         └─────────────────┘ 通过                   │
                   ┌────────▼────────┐               │
                   │   ⑤ 开发编码    │ ← 开发部       │
                   └────────┬───────┘               │
                            │                       │
                   ┌────────▼────────┐               │
         ┌─────────│   ⑥ 代码审核    │ ← 审核部       │
         │ 打回    └────────┬───────┘               │
         └─────────────────┘ 通过                   │
                   ┌────────▼────────┐               │
                   │   ⑦ 部署上线    │ ← 开发部       │
                   └────────┬───────┘               │
                            │                       │
                   ┌────────▼────────┐               │
                   │   ⑧ 完成交付    │ ← 指挥部       │
                   └─────────────────┘               │
```

**核心机制**：双重打回（内容审核+代码审核各最多3轮，超限自动暂停）、部署失败自动重试、实时通信总线全局监控。

---

## 五层安全机制

| 层级 | 名称 | 说明 |
|------|------|------|
| L1 | 工具白名单 | 按部门控制可调用工具 |
| L2 | 速率限制 | 单轮5次、全Session 50次上限 + 1秒间隔 |
| L3 | 参数校验 | URL禁内网、路径禁敏感目录、Python代码黑名单 |
| L4 | 沙箱执行 | 子进程安全包装 |
| L5 | 结果清洗 | 密钥过滤 + 长度截断 |

---

## 多协议 LLM 路由

| Provider | 协议 |
|----------|------|
| OpenAI | `/chat/completions` |
| Anthropic | `/messages` (x-api-key) |
| Google | `/v1beta/models/:model:generateContent` |
| 兼容 OpenAI 厂商 | 自定义 Base URL + API Key |

47个预置模型覆盖14家厂商，Agent 级独立配 API Key。无 Key 时自动降级 Mock 模式。

---

## 技术栈

React 18 + TypeScript + Vite 5 + Tailwind CSS + Electron 28

---

## 快速开始

```bash
npm install
npm run dev          # 浏览器开发
npm run build        # 生产构建
node build/build.mjs # 打包 Electron 桌面应用
```

---

## 项目结构

```
src/
├── core/                   # 引擎核心
│   ├── Engine.ts           # ReviewEngine 类 + store/subscribe + 事件系统
│   ├── Pipeline.ts         # 8阶段定义
│   ├── llm.ts              # 多协议路由 + callAIWithTools 工具循环
│   ├── safetyGuard.ts      # 五层安全校验
│   ├── mockResponses.ts    # Mock 降级
│   ├── types.ts            # 类型定义
│   └── Communication.ts    # 部门通信总线
├── agents/agentConfig.ts   # 四部门 + 47模型
├── ui/pages/               # Dashboard / PipelineView / AgentsPanel
├── ui/components/          # Sidebar / LogStream
└── deploy/Deployer.ts      # 部署模块
```

---

## 持久化回调

```typescript
import { engine } from './core/Engine';

engine.setPersistHandler(async (action, payload) => {
  if (action === 'stageOutputs') await db.save('outputs', payload);
});
```

---

## 同步记录

| 能力 | 状态 | 位置 |
|------|------|------|
| ReviewEngine 类 + on/emit 事件系统 | ✅ | `core/Engine.ts` |
| _persist / setPersistHandler 持久化回调 | ✅ | `core/Engine.ts` |
| callAIWithTools 工具循环（15轮+强制终止） | ✅ | `core/llm.ts` |
| 五层安全校验（白名单→速率→参数→沙箱→清洗） | ✅ | `core/safetyGuard.ts` |

---

## License

MIT © 2026 Hank个人工作室
