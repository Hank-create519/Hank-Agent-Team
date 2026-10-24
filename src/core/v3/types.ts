// ============================================================
// v3 编排契约：能力 / 任务图 / 门禁 / 审查策略
// 设计目标：流程是数据（TaskGraph），执行是通用运行时（runtime），
// 审查是策略（ReviewPolicy），所有 LLM 调用走统一 invoke。
// ============================================================

import type { Agent } from '../types';

export type CapabilityId =
  | 'plan'      // 制定方案
  | 'extract'   // 信息提取
  | 'research'  // 检索/调研（产出信息，不直接交付）
  | 'draft'     // 产出（内容/代码/方案文本）
  | 'review'    // 审查（可作门禁）
  | 'verify'    // 确定性校验（可作门禁）
  | 'deliver';  // 交付汇总

export type NodeId = string;

export interface NodeInput {
  from: NodeId | 'user';
  select?: string;
}

export interface NodeSpec {
  id: NodeId;
  capability: CapabilityId;
  title: string;
  inputs: NodeInput[];
  params: Record<string, unknown>;
  /** 门禁：required=true 时必须通过（或人工确认）才能继续 */
  gate?: { required: boolean; onFail?: 'rework' | 'pause' | 'abort' };
  /** 有界返工：审查失败时重跑 target 节点，最多 maxIterations 次 */
  loop?: {
    id: string;
    target: NodeId;
    maxIterations: number;
    /** 计数写回 Engine 的哪个打回计数器（保留旧 UI 语义） */
    counterKey?: 'contentRejectCount' | 'codeRejectCount';
  };
  parallelGroup?: string;
}

export interface TaskGraph {
  version: 1;
  goal: string;
  risk: 'low' | 'medium' | 'high';
  nodes: NodeSpec[];
  deliverableNodeId: NodeId;
  source: 'template' | 'planner';
}

export type ReviewVerdict = 'pass' | 'conditional' | 'reject';

export interface ReviewFinding {
  severity: 'high' | 'medium' | 'low';
  category?: 'security' | 'fact' | 'logic' | 'quality';
  desc: string;
  evidence?: string;
  recommendation?: string;
}

export interface GateResult {
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  /** 任一审查员走了演示/降级响应：不得作为真实通过依据 */
  degraded: boolean;
  rounds: number;
  policyId: string;
}

export interface NodeResult {
  status: 'live' | 'demo' | 'failed';
  output: string;
  elapsedMs: number;
  gate?: GateResult;
  auditIds: string[];
  error?: string;
  /** 执行该节点的 Agent / 模型（审计用） */
  agentId?: string;
  provider?: string;
  model?: string;
  /** 第几次执行（返工计数，从 1 开始） */
  attempt?: number;
  /** 上下文装配信息（截断/预算） */
  contextInfo?: ContextInfo;
}

export interface ContextInfo {
  estimatedTokens: number;
  usedChars: number;
  truncated: Array<{ id: string; label: string; originalChars: number; keptChars: number; reason: string }>;
}

/** 节点级产出（v3.1 起为业务事实源；stageOutputs 仅保留给旧 UI 兼容） */
export interface NodeOutput {
  nodeId: NodeId;
  capability: CapabilityId;
  title: string;
  status: 'live' | 'demo' | 'failed';
  content: string;
  summary: string;
  auditIds: string[];
  gate?: GateResult;
  agentId?: string;
  provider?: string;
  model?: string;
  attempt: number;
  createdAt: string;
  contextInfo?: ContextInfo;
}

/** invoke 的调用上下文：审计与预算按任务/节点归属 */
export interface InvokeContext {
  taskId: string;
  nodeId: string;
  capability: CapabilityId | 'difficulty' | 'legacy';
  attempt: number;
}

export interface NodeState {
  status: 'pending' | 'running' | 'done' | 'failed' | 'paused';
  result?: NodeResult;
}

export interface TaskRuntimeState {
  taskId: string;
  graph: TaskGraph;
  nodes: Record<NodeId, NodeState>;
  paused: boolean;
  pauseReason?: string;
  counts: { contentRejectCount: number; codeRejectCount: number };
  outcome?: 'completed' | 'demo' | 'incomplete';
}

/** 审查策略：把“审多深、谁来审、怎么判”从代码里拿出来 */
export interface ReviewPolicy {
  id: string;
  /** 单次审查的最坏模型调用次数（供图预算估算；含准备层/面板/裁决/重试余量） */
  maxCalls: number;
  preparation: { forwardExtract: boolean; reverseExtract: boolean; judgeRounds: boolean };
  panel: Array<{
    role: Agent['role'];
    promptKey: 'reviewer_logic' | 'reviewer_fact' | 'reviewer_user';
  }>;
  consensus: {
    mode: 'single' | 'quorum' | 'divergence';
    /** divergence 模式下：分歧度超过阈值才继续加轮 */
    threshold: number;
    minRounds: number;
    maxRounds: number;
  };
  verdict: { defaultDeny: boolean; blockOnSeverity: 'high' | 'medium' | 'low' };
  escalation: { onRoundLimit: 'pause' | 'reject' };
}

/** 统一调用结果（invoke.ts） */
export type InvokeStatus = 'live' | 'demo' | 'failed';

export interface InvokeUsage {
  calls: number;
  elapsedMs: number;
}

export interface InvokeError {
  code: 'no-key' | 'budget-exceeded' | 'budget-node-exceeded' | 'http-error' | 'empty-response' | 'aborted' | 'unknown';
  message: string;
  retryable: boolean;
}
