import { describe, it, expect, afterEach } from 'vitest';
import type { Agent, ModelConfig } from '../../types';
import { invokeLLM, createBudget } from '../invoke';
import type { InvokeContext } from '../types';

const MODELS: ModelConfig[] = [{ id: 'deepseek-v3', name: 'DeepSeek-V3', provider: 'DeepSeek' }];

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'agent-1',
    department: 'develop',
    model: 'deepseek-v3',
    apiKey: '',
    role: 'member',
    status: 'idle',
    currentTask: '',
    systemPrompt: '你是测试 Agent',
    skills: [],
    hasKey: true,
    stats: { tasksCompleted: 0, errors: 0, avgTime: 0 },
    ...over,
  };
}

function ctx(over: Partial<InvokeContext> = {}): InvokeContext {
  return { taskId: 'task-1', nodeId: 'n1', capability: 'draft', attempt: 1, ...over };
}

type BridgeReply = { content?: string; status?: 'live' | 'failed'; error?: string; elapsedMs?: number };

function mockBridge(handler: (payload: Record<string, unknown>) => BridgeReply) {
  const calls: Array<Record<string, unknown>> = [];
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      llmCall: async (payload: Record<string, unknown>) => {
        calls.push(payload);
        const r = handler(payload);
        return { content: r.content || '', error: r.error, elapsedMs: r.elapsedMs ?? 3, status: r.status || 'live' };
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('invokeLLM：统一调用语义', () => {
  it('live：返回完整字段（auditId/context/provider/model/retryCount/source）', async () => {
    mockBridge(() => ({ content: '产出内容', status: 'live', elapsedMs: 12 }));
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false });
    expect(out.status).toBe('live');
    expect(out.content).toBe('产出内容');
    expect(out.auditId).toMatch(/^inv_/);
    expect(out.auditIds.length).toBe(1);
    expect(out.provider).toBe('DeepSeek');
    expect(out.model).toBe('deepseek-v3');
    expect(out.agentId).toBe('agent-1');
    expect(out.context.taskId).toBe('task-1');
    expect(out.retryCount).toBe(0);
  });

  it('不向主进程发送 baseUrl（端点由主进程解析）', async () => {
    const calls = mockBridge(() => ({ content: 'ok' }));
    await invokeLLM({ context: ctx(), agent: agent() as Agent & { baseUrl: string }, models: MODELS, stage: 'draft', userPrompt: 'x', demo: false });
    expect(calls.length).toBe(1);
    expect(calls[0]).not.toHaveProperty('baseUrl');
    expect(calls[0].taskId).toBe('task-1');
    expect(calls[0].nodeId).toBe('n1');
  });

  it('demo：不触网，返回 demo 标记（永不冒充 live）', async () => {
    let called = false;
    (globalThis as unknown as { window: unknown }).window = { electronAPI: { llmCall: async () => { called = true; return { content: '', status: 'failed' }; } } };
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'develop', userPrompt: '写代码', demo: true });
    expect(out.status).toBe('demo');
    expect(called).toBe(false);
  });

  it('failed：返回 failed + 错误结构，不返回伪造内容', async () => {
    mockBridge(() => ({ status: 'failed', error: '401 Unauthorized' }));
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, retry: { max: 0 } });
    expect(out.status).toBe('failed');
    expect(out.content).toBe('');
    expect(out.error?.code).toBe('http-error');
  });

  it('可重试错误自动重试并记录 retryCount', async () => {
    let n = 0;
    mockBridge(() => {
      n += 1;
      return n === 1 ? { status: 'failed', error: '超时 timeout' } : { content: '第二次成功', status: 'live' };
    });
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, retry: { max: 1 } });
    expect(out.status).toBe('live');
    expect(out.retryCount).toBe(1);
    expect(out.auditIds.length).toBe(2);
  });

  it('不可重试错误（无效 Key）不重试', async () => {
    let n = 0;
    mockBridge(() => { n += 1; return { status: 'failed', error: '未配置 API Key' }; });
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, retry: { max: 2 } });
    expect(out.status).toBe('failed');
    expect(n).toBe(1);
    expect(out.error?.code).toBe('no-key');
  });

  it('任务级预算超限时直接失败，不触网', async () => {
    let called = false;
    (globalThis as unknown as { window: unknown }).window = { electronAPI: { llmCall: async () => { called = true; return { content: 'x', status: 'live' }; } } };
    const budget = createBudget(1, 2);
    budget.taskCalls = 1;
    const out = await invokeLLM({ context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, budget });
    expect(out.status).toBe('failed');
    expect(out.error?.code).toBe('budget-exceeded');
    expect(called).toBe(false);
  });

  it('节点级预算限制防止单个节点耗尽任务预算', async () => {
    const budget = createBudget(100, 2);
    // 前两次通过（重试会消耗节点预算）
    let n = 0;
    mockBridge(() => { n += 1; return { content: `ok${n}`, status: 'live' }; });
    await invokeLLM({ context: ctx({ nodeId: 'n-loop' }), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, budget });
    await invokeLLM({ context: ctx({ nodeId: 'n-loop' }), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, budget });
    const third = await invokeLLM({ context: ctx({ nodeId: 'n-loop' }), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false, budget });
    expect(third.status).toBe('failed');
    expect(third.error?.code).toBe('budget-node-exceeded');
  });

  it('中止信号在调用前抛 AbortError', async () => {
    mockBridge(() => ({ content: 'x' }));
    const controller = new AbortController();
    controller.abort();
    await expect(invokeLLM({
      context: ctx(), agent: agent(), models: MODELS, stage: 'draft', userPrompt: 'x', demo: false,
      signal: controller.signal,
    })).rejects.toThrow('Aborted');
  });
});
