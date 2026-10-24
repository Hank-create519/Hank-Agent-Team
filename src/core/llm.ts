// ============================================================
// legacy callLLM 适配器（v3.1）
//
// 说明：自 v3.1 起，所有 LLM 调用的唯一实现是 `src/core/v3/invoke.ts`。
// 本文件只保留给 legacy 固定流水线（v4 将删除）做类型适配：
//   callLLM(...) → invokeLLM({ context:{taskId,nodeId:'legacy:<stage>'}, ... })
// 真实 HTTP 仍只在主进程网关；demo/failed 语义与 v3 完全一致。
// ============================================================

import type { Agent, ModelConfig, PipelineStage } from './types';
import { invokeLLM, type InvokeOutput } from './v3/invoke';

export { safeJsonParse } from './utils/json';

export interface LLMResult {
  content: string;
  error?: string;
  elapsedMs: number;
  mock: boolean;
  retryCount: number;
  status: 'live' | 'demo' | 'failed';
  auditId?: string;
}

function toLLMResult(out: InvokeOutput, started: number): LLMResult {
  return {
    content: out.content,
    error: out.error?.message,
    elapsedMs: out.elapsedMs || Date.now() - started,
    mock: out.status !== 'live',
    retryCount: out.retryCount,
    status: out.status,
    auditId: out.auditId,
  };
}

export async function callLLM(
  agent: Agent,
  models: ModelConfig[],
  stage: PipelineStage,
  userPrompt: string,
  signal?: AbortSignal,
  opts?: { demo?: boolean; taskId?: string; nodeId?: string },
): Promise<LLMResult> {
  const started = Date.now();
  // legacy 引擎在 demo 模式下仍需要 fixtures；未显式传 demo 时按"无 bridge 即 demo"的旧语义由 invoke 处理，
  // 但 legacy 的 runStage 会显式传 opts.demo（见 Engine.runStage）。
  const out = await invokeLLM({
    context: {
      taskId: opts?.taskId || 'legacy-task',
      nodeId: opts?.nodeId || `legacy:${stage}`,
      capability: 'legacy',
      attempt: 0,
    },
    agent,
    models,
    stage,
    userPrompt,
    demo: Boolean(opts?.demo),
    signal,
  });
  // demo 时 invoke 返回 mock；为兼容旧行为，browser/无 bridge 且未显式 demo 的场景仍返回 demo
  const normalized: InvokeOutput = out.status === 'failed' && !out.error
    ? out
    : out;
  return toLLMResult(normalized, started);
}
