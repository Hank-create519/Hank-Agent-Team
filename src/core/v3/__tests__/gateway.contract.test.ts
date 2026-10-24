// 主进程网关契约测试：验证 baseUrl 安全边界、Provider 端点解析、审计上下文。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const requireCjs = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../../../..');
const gateway = requireCjs(path.join(ROOT, 'electron/llm-gateway.cjs'));
const secrets = requireCjs(path.join(ROOT, 'electron/secrets.cjs'));
const audit = requireCjs(path.join(ROOT, 'electron/audit.cjs'));

let tmpDir = '';
const realFetch = globalThis.fetch;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hank-gateway-test-'));
  secrets.init({ userDataPath: tmpDir, safeStorage: undefined });
  audit.init({ userDataPath: tmpDir });
  secrets.setSecret('agent-1', 'sk-test-key-not-real');
});

afterAll(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetchOk(content: string) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

describe('网关：baseUrl 安全边界（Renderer 不能控制真实模型端点）', () => {
  it('Renderer 传入 baseUrl 必须被拒绝，且不发起任何网络请求', async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (...args: unknown[]) => {
      calls.push(args);
      throw new Error('不应该发起网络请求');
    }) as unknown as typeof fetch;

    const r = await gateway.callLLM({
      agentId: 'agent-1',
      provider: 'OpenAI',
      model: 'gpt-4o',
      baseUrl: 'https://attacker.example/v1',
      userPrompt: 'hello',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('baseUrl');
    expect(calls.length).toBe(0);
  });

  it('正常调用不携带 baseUrl：请求发往主进程维护的厂商端点', async () => {
    const calls = mockFetchOk('主进程返回内容');
    const r = await gateway.callLLM({
      agentId: 'agent-1',
      provider: 'OpenAI',
      model: 'gpt-4o',
      userPrompt: 'hello',
      taskId: 'task-9',
      nodeId: 'n2',
      attempt: 1,
    });
    expect(r.status).toBe('live');
    expect(r.content).toBe('主进程返回内容');
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('审计记录包含 taskId/nodeId/attempt（可追溯到节点）', async () => {
    mockFetchOk('ok');
    await gateway.callLLM({
      agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o',
      userPrompt: 'hello', taskId: 'task-77', nodeId: 'draft-1', attempt: 2,
    });
    const entries = audit.tail(20);
    const entry = entries[entries.length - 1];
    expect(entry.type).toBe('llm-call');
    expect(entry.taskId).toBe('task-77');
    expect(entry.nodeId).toBe('draft-1');
    expect(entry.attempt).toBe(2);
  });
});

describe('网关：Provider 端点解析（不允许静默回退）', () => {
  it('受支持厂商返回主进程维护的端点', () => {
    expect(gateway.resolveEndpoint('OpenAI')).toBe('https://api.openai.com/v1');
    expect(gateway.resolveEndpoint('DeepSeek')).toBe('https://api.deepseek.com/v1');
    expect(gateway.resolveEndpoint('Anthropic')).toBe('https://api.anthropic.com/v1');
  });

  it('未知 Provider 明确失败，不静默落到 OpenAI', () => {
    expect(() => gateway.resolveEndpoint('SomeUnknownVendor')).toThrow('未知 Provider');
  });

  it('未配置端点的厂商明确失败（腾讯混元/Meta）', () => {
    expect(() => gateway.resolveEndpoint('腾讯混元')).toThrow('暂无默认端点');
    expect(() => gateway.resolveEndpoint('Meta')).toThrow('暂无默认端点');
  });

  it('未知 Provider 调用返回 failed，且不触网', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error('no network'); }) as unknown as typeof fetch;
    const r = await gateway.callLLM({
      agentId: 'agent-1', provider: 'SomeUnknownVendor', model: 'x', userPrompt: 'hi',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('provider 未知');
    expect(called).toBe(false);
  });

  it('未配置 Key 时明确失败（不伪造成功）', async () => {
    const r = await gateway.callLLM({
      agentId: 'agent-without-key', provider: 'OpenAI', model: 'gpt-4o', userPrompt: 'hi',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('未配置 API Key');
  });
});


describe('网关：IPC payload 校验（v3.2）', () => {
  it('合法 payload 通过校验', () => {
    const r = gateway.validatePayload({
      agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o',
      dept: 'review', stage: 'review', userPrompt: 'hello', attempt: 1,
      taskId: 'task-1', nodeId: 'n1', requestId: 'req-1',
    });
    expect(r.ok).toBe(true);
  });

  it('拒绝超长 Prompt', () => {
    const r = gateway.validatePayload({
      agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o',
      userPrompt: 'x'.repeat(100001),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('userPrompt');
  });

  it('拒绝未知 provider / 非法部门 / 异常 sessionId / 非法 attempt', () => {
    const r = gateway.validatePayload({
      agentId: 'agent-1', provider: 'UnknownVendor', model: 'm',
      dept: 'selling', sessionId: 'x'.repeat(200), attempt: 1.5,
      userPrompt: 'hi',
    });
    expect(r.ok).toBe(false);
    const msg = r.errors.join('；');
    expect(msg).toContain('provider 未知');
    expect(msg).toContain('dept 非法');
    expect(msg).toContain('sessionId 非法');
    expect(msg).toContain('attempt 非法');
  });

  it('非法 payload 调用返回 failed + 审计拒绝事件，且不触网', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error('no network'); }) as unknown as typeof fetch;
    const r = await gateway.callLLM({ agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o', userPrompt: '' });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('参数校验失败');
    expect(called).toBe(false);
    const entries = audit.tail(20);
    expect(entries.some((e: Record<string, unknown>) => e.type === 'llm-call-rejected' && e.reason === 'payload-invalid')).toBe(true);
  });
});

describe('网关：主进程 auditId 与取消（v3.2）', () => {
  it('真实调用返回主进程生成的 auditId，且审计日志可回查', async () => {
    mockFetchOk('内容');
    const r = await gateway.callLLM({
      agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o',
      userPrompt: 'hi', taskId: 'task-audit', nodeId: 'n1', requestId: 'req-audit',
    });
    expect(r.status).toBe('live');
    expect(r.auditId).toMatch(/^aud_/);
    const entries = audit.tail(50);
    expect(entries.some((e: Record<string, unknown>) => e.auditId === r.auditId && e.type === 'llm-call')).toBe(true);
  });

  it('取消：cancelTask 会中止登记的在途请求（信号可用）', async () => {
    let observedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      // 模拟挂起：直到被 abort 才结束
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const p = gateway.callLLM({
      agentId: 'agent-1', provider: 'OpenAI', model: 'gpt-4o',
      userPrompt: 'hi', taskId: 'task-cancel', requestId: 'req-cancel',
    });
    await new Promise(r => setTimeout(r, 10));
    const { cancelled } = gateway.cancelTask('task-cancel');
    expect(cancelled).toBe(1);
    const r = await p;
    expect(r.status).toBe('failed');
    expect(observedSignal?.aborted).toBe(true);
  });
});
