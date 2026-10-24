import { describe, it, expect, afterEach } from 'vitest';
import type { Agent, ModelConfig } from '../../types';
import { runReview, REVIEW_POLICIES } from '../review';

const MODELS: ModelConfig[] = [{ id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' }];

function agent(id: string, role: Agent['role']): Agent {
  return {
    id,
    name: id,
    department: 'review',
    model: 'gpt-4o',
    apiKey: '',
    role,
    status: 'idle',
    currentTask: '',
    systemPrompt: `你是 ${id}`,
    skills: [],
    assignedSkills: [],
    hasKey: true,
    stats: { tasksCompleted: 0, errors: 0, avgTime: 0 },
  };
}

const AGENTS: Agent[] = [
  agent('rev-logic', 'reviewer_logic'),
  agent('rev-fact', 'reviewer_fact'),
  agent('rev-user', 'reviewer_user'),
  agent('rev-leader', 'leader'),
  agent('rev-member', 'member'),
];

type BridgeReply = { content?: string; status?: 'live' | 'failed'; error?: string };

function mockBridge(handler: (payload: { systemPrompt?: string; userPrompt?: string }) => BridgeReply) {
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      llmCall: async (payload: { systemPrompt?: string; userPrompt?: string }) => {
        const r = handler(payload);
        return { content: r.content || '', error: r.error, elapsedMs: 1, status: r.status || 'live' };
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function baseReq(policyId: string) {
  return {
    targetLabel: '测试方案',
    targetContent: '这是一个测试方案：先做 A，再做 B，最后验证 C。',
    policyId,
    agents: AGENTS,
    models: MODELS,
    demo: false,
    context: { taskId: 'test-task', nodeId: 'n-review' },
  };
}

describe('v3 审查服务：策略化', () => {
  it('三套预设策略存在且字段合理', () => {
    expect(REVIEW_POLICIES.quick.panel).toHaveLength(1);
    expect(REVIEW_POLICIES.standard.panel).toHaveLength(2);
    expect(REVIEW_POLICIES.panel.panel).toHaveLength(3);
    expect(REVIEW_POLICIES.panel.consensus.maxRounds).toBeLessThanOrEqual(3);
  });

  it('demo 模式：不调用模型，返回 degraded + conditional（不得作为真实通过）', async () => {
    const outcome = await runReview({ ...baseReq('panel'), demo: true });
    expect(outcome.gate.verdict).toBe('conditional');
    expect(outcome.gate.degraded).toBe(true);
    expect(outcome.gate.rounds).toBe(0);
  });

  it('quick：审查员明确通过 → pass（真实调用）', async () => {
    mockBridge(payload => {
      if (payload.systemPrompt?.includes('一号审查员')) {
        return { content: '逻辑上没有问题。\n{"result":"approved","issues":[]}' };
      }
      return { content: 'ok' };
    });
    const outcome = await runReview(baseReq('quick'));
    expect(outcome.gate.verdict).toBe('pass');
    expect(outcome.gate.degraded).toBe(false);
  });

  it('quick：审查员驳回 → reject', async () => {
    mockBridge(() => ({ content: '存在严重问题。\n{"result":"rejected","issues":["缺少边界条件处理"]}' }));
    const outcome = await runReview(baseReq('quick'));
    expect(outcome.gate.verdict).toBe('reject');
    expect(outcome.gate.findings.length).toBeGreaterThan(0);
  });

  it('quick：调用失败 → 降级，最高 conditional', async () => {
    mockBridge(() => ({ status: 'failed', error: '未配置 API Key' }));
    const outcome = await runReview(baseReq('quick'));
    expect(outcome.gate.verdict).toBe('conditional');
    expect(outcome.gate.degraded).toBe(true);
  });

  it('panel：裁决官给出 pass → pass', async () => {
    mockBridge(payload => {
      if (payload.systemPrompt?.includes('首席裁决官')) {
        return { content: '裁决如下\n{"verdict":"pass","issues":[],"suggestions":[]}' };
      }
      if (payload.systemPrompt?.includes('轮次裁判')) return { content: '需要 2 轮' };
      if (payload.systemPrompt?.includes('一号审查员')) return { content: '逻辑通过。评分：8/10' };
      if (payload.systemPrompt?.includes('二号审查员')) return { content: '事实核查通过。评分：8/10' };
      if (payload.systemPrompt?.includes('三号审查员')) return { content: '用户视角通过。评分：8/10' };
      return { content: '提取完成' };
    });
    const outcome = await runReview(baseReq('panel'));
    expect(outcome.gate.verdict).toBe('pass');
    expect(outcome.gate.policyId).toBe('panel');
    expect(outcome.gate.rounds).toBeGreaterThanOrEqual(1);
  });

  it('panel：裁决 pass 但有 high 级问题 → 不得 pass', async () => {
    mockBridge(payload => {
      if (payload.systemPrompt?.includes('首席裁决官')) {
        return { content: '{"verdict":"pass","issues":[{"severity":"high","desc":"存在越权风险"}],"suggestions":[]}' };
      }
      if (payload.systemPrompt?.includes('轮次裁判')) return { content: '需要 1 轮' };
      return { content: '审查意见。评分：7/10' };
    });
    const outcome = await runReview(baseReq('panel'));
    expect(outcome.gate.verdict).not.toBe('pass');
    expect(outcome.gate.findings.some(f => f.severity === 'high')).toBe(true);
  });

  it('panel：任一审查调用失败 → 降级，不得 pass', async () => {
    mockBridge(payload => {
      if (payload.systemPrompt?.includes('首席裁决官')) {
        return { content: '{"verdict":"pass","issues":[]}' };
      }
      if (payload.systemPrompt?.includes('二号审查员')) {
        return { status: 'failed', error: '超时' };
      }
      return { content: '审查意见。评分：8/10' };
    });
    const outcome = await runReview(baseReq('panel'));
    expect(outcome.gate.degraded).toBe(true);
    expect(outcome.gate.verdict).not.toBe('pass');
  });

  it('审查 JSON Schema：findings 带 category/evidence/recommendation', async () => {
    mockBridge(() => ({
      content: '{"verdict":"reject","issues":[{"severity":"high","category":"security","desc":"存在越权","evidence":"L10","recommendation":"加白名单"}]}',
    }));
    const outcome = await runReview(baseReq('quick'));
    expect(outcome.gate.verdict).toBe('reject');
    const finding = outcome.gate.findings[0];
    expect(finding.category).toBe('security');
    expect(finding.evidence).toBe('L10');
    expect(finding.recommendation).toBe('加白名单');
  });

  it('裁决 JSON 解析不到 → default-deny（不猜通过）', async () => {
    mockBridge(payload => {
      if (payload.systemPrompt?.includes('首席裁决官')) {
        return { content: '这篇内容我觉得还行吧。' };
      }
      if (payload.systemPrompt?.includes('轮次裁判')) return { content: '需要 1 轮' };
      return { content: '审查意见。评分：7/10' };
    });
    const outcome = await runReview(baseReq('panel'));
    expect(outcome.gate.verdict).not.toBe('pass');
  });
});
