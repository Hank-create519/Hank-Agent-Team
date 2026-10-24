// ============================================================
// 统一调用器（v3.1）：所有 LLM 调用的唯一实现。
//
// 规则（对齐技术升级方案）：
//   1) 唯一入口：plan/extract/draft/deliver/review/difficulty 全部经由本文件；
//   2) 每次调用必须有 context（taskId/nodeId/attempt）与 auditId；
//   3) 预算：任务级 + 节点级双重限制（防止单个返工节点耗尽资源）；
//   4) demo / live / failed 三态严格区分，failed 永不返回伪造内容；
//   5) Renderer 不提供 baseUrl：只传 agentId/provider/model，端点由主进程解析；
//   6) 失败可重试（retry.max），重试耗尽后返回 failed，由编排层暂停等人工。
// ============================================================

import type { Agent, ModelConfig } from '../types';
import type { InvokeContext, InvokeError, InvokeStatus } from './types';
import { mockResponse } from '../mockResponses';

export interface InvokeBudget {
  /** 任务级：已用 / 上限 */
  taskCalls: number;
  maxTaskCalls: number;
  /** 节点级：按 nodeId 记录 */
  nodeCalls: Map<string, number>;
  maxNodeCalls: number;
}

export function createBudget(maxTaskCalls: number, maxNodeCalls: number): InvokeBudget {
  return { taskCalls: 0, maxTaskCalls, nodeCalls: new Map(), maxNodeCalls };
}

export interface InvokeInput {
  context: InvokeContext;
  agent: Agent;
  models: ModelConfig[];
  /** 审计标签（capability 或 legacy stage） */
  stage: string;
  systemPrompt?: string;
  userPrompt: string;
  /** demo 模式：不碰网络，返回 fixtures 并标记 demo */
  demo: boolean;
  signal?: AbortSignal;
  budget?: InvokeBudget;
  /** 失败重试次数（仅 live；默认 1） */
  retry?: { max: number };
}

export interface InvokeOutput {
  status: InvokeStatus;
  content: string;
  elapsedMs: number;
  /** 最后一次尝试的 auditId（auditIds 为全部尝试） */
  auditId: string;
  auditIds: string[];
  retryCount: number;
  provider: string;
  model: string;
  agentId: string;
  context: InvokeContext;
  error?: InvokeError;
}

let _auditSeq = 0;

function nextAuditId(): string {
  _auditSeq += 1;
  return `inv_${Date.now().toString(36)}_${_auditSeq}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ElectronBridgeResult {
  content?: string;
  error?: string;
  errorCode?: string;
  elapsedMs?: number;
  status?: 'live' | 'failed';
  auditId?: string;
}

function mapError(message: string, errorCode?: string): InvokeError {
  if (errorCode === 'aborted') {
    return { code: 'aborted', message, retryable: false };
  }
  if (errorCode === 'empty-response') {
    return { code: 'empty-response', message, retryable: true };
  }
  const retryable = /超时|timeout|429|5\d\d|ECONN|network|fetch failed/i.test(message);
  if (errorCode === 'no-key' || /未配置 API Key|no-key|未配置密钥/i.test(message)) {
    return { code: 'no-key', message, retryable: false };
  }
  if (/预算/.test(message)) {
    return { code: 'budget-exceeded', message, retryable: false };
  }
  if (/空响应|empty/i.test(message)) {
    return { code: 'empty-response', message, retryable: true };
  }
  return { code: 'http-error', message, retryable };
}

function checkBudget(budget: InvokeBudget | undefined, nodeId: string): InvokeError | null {
  if (!budget) return null;
  if (budget.taskCalls >= budget.maxTaskCalls) {
    return {
      code: 'budget-exceeded',
      message: `任务调用预算超限（上限 ${budget.maxTaskCalls} 次）`,
      retryable: false,
    };
  }
  const nodeUsed = budget.nodeCalls.get(nodeId) || 0;
  if (nodeUsed >= budget.maxNodeCalls) {
    return {
      code: 'budget-node-exceeded',
      message: `节点调用预算超限（${nodeId} 上限 ${budget.maxNodeCalls} 次）`,
      retryable: false,
    };
  }
  return null;
}

function recordBudget(budget: InvokeBudget | undefined, nodeId: string): void {
  if (!budget) return;
  budget.taskCalls += 1;
  budget.nodeCalls.set(nodeId, (budget.nodeCalls.get(nodeId) || 0) + 1);
}

async function callBridge(payload: {
  ctx: InvokeContext;
  agent: Agent;
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  requestId: string;
}): Promise<ElectronBridgeResult> {
  const api = (window as unknown as {
    electronAPI?: { llmCall?: (p: unknown) => Promise<ElectronBridgeResult> };
  }).electronAPI;
  if (!api?.llmCall) {
    return { status: 'failed', error: '当前环境无 Electron 主进程网关（浏览器模式仅支持 demo）' };
  }
  return api.llmCall({
    agentId: payload.agent.id,
    provider: payload.provider,
    model: payload.model,
    // 注意：不传 baseUrl —— 端点由主进程按 provider 解析
    systemPrompt: payload.systemPrompt,
    userPrompt: payload.userPrompt,
    dept: payload.agent.department,
    stage: payload.ctx.capability,
    sessionId: payload.ctx.taskId,
    taskId: payload.ctx.taskId,
    nodeId: payload.ctx.nodeId,
    attempt: payload.ctx.attempt,
    requestId: payload.requestId,
  });
}

export async function invokeLLM(input: InvokeInput): Promise<InvokeOutput> {
  const started = Date.now();
  const ctx = input.context;
  const model = input.models.find(m => m.id === input.agent.model);
  const provider = model?.provider || 'OpenAI';
  const modelId = input.agent.model;

  const budgetError = checkBudget(input.budget, ctx.nodeId);
  if (budgetError) {
    const auditId = nextAuditId();
    return {
      status: 'failed',
      content: '',
      elapsedMs: 0,
      auditId,
      auditIds: [auditId],
      retryCount: 0,
      provider,
      model: modelId,
      agentId: input.agent.id,
      context: ctx,
      error: budgetError,
    };
  }

  const maxRetry = Math.max(0, input.retry?.max ?? 1);
  const auditIds: string[] = [];
  let lastError: InvokeError | undefined;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    if (attempt > 0) {
      retryCount += 1;
      await delay(400 * attempt);
    }
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const auditId = nextAuditId();
    auditIds.push(auditId);
    recordBudget(input.budget, ctx.nodeId);

    // demo：不碰网络，返回 fixtures（产出标记 demo，不得通过 live 门禁）
    if (input.demo) {
      await delay(60 + Math.random() * 60);
      return {
        status: 'demo',
        content: mockResponse(input.stage as never, input.userPrompt),
        elapsedMs: Date.now() - started,
        auditId,
        auditIds,
        retryCount,
        provider,
        model: modelId,
        agentId: input.agent.id,
        context: ctx,
      };
    }

    // 无 Electron bridge：只能演示，不允许伪造真实调用
    const hasBridge = Boolean(
      (window as unknown as { electronAPI?: { llmCall?: unknown } }).electronAPI?.llmCall,
    );
    if (!hasBridge) {
      await delay(60);
      return {
        status: 'demo',
        content: mockResponse(input.stage as never, input.userPrompt),
        elapsedMs: Date.now() - started,
        auditId,
        auditIds,
        retryCount,
        provider,
        model: modelId,
        agentId: input.agent.id,
        context: ctx,
      };
    }

    try {
      const r = await callBridge({
        ctx: { ...ctx, attempt: ctx.attempt + attempt },
        agent: input.agent,
        provider,
        model: modelId,
        systemPrompt: input.systemPrompt || input.agent.systemPrompt || '你是 Hank Agent Team 的一员，请按要求完成任务。',
        userPrompt: input.userPrompt,
        requestId: auditId,
      });
      // 真实调用的 auditId 由主进程生成/落盘；renderer 侧以返回值为准（可回查 audit-log.jsonl）
      if (r.auditId) {
        auditIds[auditIds.length - 1] = r.auditId;
      }
      if (r.status === 'live' && (r.content || '').length > 0) {
        return {
          status: 'live',
          content: r.content || '',
          elapsedMs: r.elapsedMs ?? Date.now() - started,
          auditId: r.auditId || auditId,
          auditIds,
          retryCount,
          provider,
          model: modelId,
          agentId: input.agent.id,
          context: ctx,
        };
      }
      lastError = mapError(r.error || '主进程调用失败', r.errorCode);
    } catch (e: unknown) {
      lastError = mapError(e instanceof Error ? e.message : String(e));
    }

    if (lastError && !lastError.retryable) break;
  }

  return {
    status: 'failed',
    content: '',
    elapsedMs: Date.now() - started,
    auditId: auditIds[auditIds.length - 1] || nextAuditId(),
    auditIds,
    retryCount,
    provider,
    model: modelId,
    agentId: input.agent.id,
    context: ctx,
    error: lastError || { code: 'unknown', message: '调用失败', retryable: false },
  };
}
