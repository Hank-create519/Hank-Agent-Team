<div align="center">

# Hank Agent Team

### 一个把 AI 协作过程摊开来看的桌面项目

Electron · React · TypeScript · Vite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)](https://www.electronjs.org/)

</div>

---

## 这个项目在做什么

我做 Hank Agent Team，是想试着把一个复杂需求拆成几段看得见的工作：先整理方案，再提取和审核信息，接着生成开发产出、做代码审查，最后整理交付说明。

应用里有四个职责不同的 Agent 部门：指挥部、信息部、开发部和审核部。它们按阶段交接，界面会显示当前阶段、产出、审核意见和任务状态。遇到 API 故障或需要人工判断时，可以暂停、重试或停止。

它是一个桌面协作流程原型。当前主流程主要组织模型生成的文字和审核记录；开发阶段不会自动把结果写入你指定的 Git 项目，部署阶段也只生成操作说明，不会替你上线。这样写清楚边界，比显示一个看起来很漂亮的“部署成功”更重要。

## 流程

1. 指挥部整理需求并提出方案
2. 审查框架检查方案
3. 信息部提取任务所需信息
4. 审核部检查信息，必要时打回
5. 开发部生成实现方案或代码产出
6. 审核部检查开发产出，必要时打回
7. 开发部整理部署步骤、环境要求和回滚建议
8. 指挥部汇总并交付本次结果

内容审核与代码审核分别记录打回次数；达到重试上限时流程会暂停。真实 API 调用、演示输出和降级判断会分别标记，便于回头查看这次任务实际走了哪条路径。

## 技术实现

| 部分 | 实现 |
|------|------|
| 桌面端 | Electron 28，主进程负责窗口、生命周期与受限 IPC |
| 界面 | React 18 + TypeScript，Vite 构建，Tailwind CSS 样式 |
| 状态 | Zustand 保存界面配置、任务历史和用户偏好 |
| 流程引擎 | TypeScript 状态模型驱动阶段流转，记录阶段产出、日志、暂停状态和审查结果 |
| 模型接入 | 独立 Provider 调用层，支持 OpenAI 兼容接口、Anthropic 和 Google；每个 Agent 可分别配置模型 |
| 审查 | 方案审查框架与内容、代码审核分开运行；明确记录通过、条件通过、拒绝和降级状态 |
| 演示模式 | 没有 API Key 时可用模拟输出体验流程；演示结果会标记为 demo |

仓库中也有部门级工具权限、URL 和文件路径检查、Python 输入校验、输出清洗等安全逻辑。当前主流程还没有接入完整的真实工作区工具执行器，因此这些检查不代表它已经能安全地自动修改项目文件。

## 架构图

<div align="center">

**阶段流程**

<img src="docs/architecture/pipeline-overview.svg" alt="四部门流水线总览" width="100%" />

**审核闭环**

<img src="docs/architecture/review-loop.svg" alt="内容与代码审核闭环" width="100%" />

**模型接入**

<img src="docs/architecture/llm-gateway.svg" alt="LLM 接入层" width="100%" />

</div>

## 下载

前往 [Releases](https://github.com/Hank-create519/Hank-Agent-Team/releases) 查看桌面版安装包。

| 平台 | 格式 |
|------|------|
| Windows | NSIS 安装包或便携版 |
| macOS | DMG（通过主项目 electron-builder 配置构建） |

## 本地运行

需要安装 Node.js。Windows/macOS 开发和构建命令：

    cd win
    npm ci
    npm run dev

构建渲染层：

    npm run build

构建桌面包：

    npm run dist:win
    npm run dist:mac

运行检查：

    npm run typecheck
    npm test

## 仓库结构

| 目录 | 说明 |
|------|------|
| `win/` | 当前主项目源码与 electron-builder 配置，包含 Windows 和 macOS 构建目标 |
| `mac/` | 较早期 macOS 版本的存档 |
| `docs/architecture/` | 流程和模块架构图 |

更完整的构建说明见 [win/README.md](./win/README.md)。

## License

[MIT](./LICENSE) © 2026 Hank
