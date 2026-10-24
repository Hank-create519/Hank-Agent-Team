import { describe, it, expect } from 'vitest';
import { runGraph, type RuntimeHandlers } from '../runtime';
import type { NodeResult, NodeSpec, TaskGraph } from '../types';

function result(output: string, gate?: NodeResult['gate']): NodeResult {
  return { status: 'live', output, elapsedMs: 1, auditIds: [], gate };
}

function passGate() {
  return { verdict: 'pass' as const, findings: [], degraded: false, rounds: 1, policyId: 'quick' };
}

function rejectGate() {
  return {
    verdict: 'reject' as const,
    findings: [{ severity: 'medium' as const, desc: '需要返工' }],
    degraded: false,
    rounds: 1,
    policyId: 'quick',
  };
}

function graph(nodes: NodeSpec[], deliverableNodeId = nodes[nodes.length - 1].id): TaskGraph {
  return { version: 1, goal: 'test', risk: 'low', nodes, deliverableNodeId, source: 'template' };
}

function handlers(over: Partial<RuntimeHandlers> = {}): RuntimeHandlers {
  return {
    isAborted: () => false,
    waitIfPaused: async () => {},
    execute: async (node: NodeSpec) => result(`out:${node.id}`),
    review: async () => result('review', passGate()),
    onNodeStart: () => {},
    onNodeDone: () => {},
    onGateFailure: async () => 'accept',
    ...over,
  };
}

describe('v3 图运行时', () => {
  it('按依赖顺序执行节点并返回结果', async () => {
    const order: string[] = [];
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }], params: { policy: 'quick', kind: 'code' }, gate: { required: true } },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    const results = await runGraph(g, handlers({
      onNodeStart: node => order.push(node.id),
    }));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(results.c).toBeDefined();
    expect(results.b.gate?.verdict).toBe('pass');
  });

  it('门禁不通过时按 loop 重跑 target（有界），通过后继续', async () => {
    let reviewCount = 0;
    let executeCount = 0;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      {
        id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }],
        params: { policy: 'quick' }, gate: { required: true },
        loop: { id: 'l1', target: 'a', maxIterations: 2, counterKey: 'codeRejectCount' },
      },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    const results = await runGraph(g, handlers({
      execute: async node => {
        executeCount += 1;
        return result(`out:${node.id}`);
      },
      review: async () => {
        reviewCount += 1;
        return result('review', reviewCount >= 2 ? passGate() : rejectGate());
      },
      incrementCounter: () => reviewCount,
    }));
    expect(executeCount).toBeGreaterThanOrEqual(2);
    expect(results.b.gate?.verdict).toBe('pass');
  });

  it('返工耗尽且门禁仍不通过：交给人工决策（abort 时抛错）', async () => {
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      {
        id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }],
        params: { policy: 'quick' }, gate: { required: true },
        loop: { id: 'l1', target: 'a', maxIterations: 1 },
      },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    await expect(runGraph(g, handlers({
      review: async () => result('review', rejectGate()),
      onGateFailure: async () => 'abort',
      incrementCounter: () => 9,
    }))).rejects.toThrow('门禁未通过');
  });

  it('人工确认 accept 后继续交付（留痕由引擎负责）', async () => {
    let gateFailed = false;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }], params: { policy: 'quick' }, gate: { required: true } },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    const results = await runGraph(g, handlers({
      review: async () => result('review', rejectGate()),
      onGateFailure: async () => { gateFailed = true; return 'accept'; },
    }));
    expect(gateFailed).toBe(true);
    expect(results.c).toBeDefined();
  });

  it('并行组并发执行', async () => {
    const starts: number[] = [];
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'v1', capability: 'verify', title: 'v1', inputs: [{ from: 'a' }], params: {}, parallelGroup: 'g1', gate: { required: true } },
      { id: 'v2', capability: 'verify', title: 'v2', inputs: [{ from: 'a' }], params: {}, parallelGroup: 'g1', gate: { required: true } },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'v1' }, { from: 'v2' }], params: {} },
    ]);
    await runGraph(g, handlers({
      execute: async node => {
        starts.push(Date.now());
        if (node.capability === 'verify') await new Promise(r => setTimeout(r, 30));
        return result(`out:${node.id}`, node.capability === 'verify' ? passGate() : undefined);
      },
    }));
    expect(starts.length).toBe(4);
    // 两个 verify 的启动时间应非常接近（并发），而不是串行 30ms 间隔
    expect(Math.abs(starts[2] - starts[1])).toBeLessThan(20);
  });

  it('依赖无法满足时报错（防死循环）', async () => {
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'b' }], params: {} },
      { id: 'b', capability: 'deliver', title: 'b', inputs: [{ from: 'user' }], params: {} },
    ]);
    await expect(runGraph(g, handlers())).rejects.toThrow('依赖无法满足');
  });

  it('用户中止时抛 AbortError', async () => {
    let n = 0;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'deliver', title: 'b', inputs: [{ from: 'a' }], params: {} },
    ]);
    await expect(runGraph(g, handlers({ isAborted: () => { n += 1; return n > 0; } })))
      .rejects.toThrow('Aborted');
  });
});

describe('v3 图运行时：v3.1 失败传播与中止语义', () => {
  it('非门禁节点失败时中止任务，不向下游传播', async () => {
    let downstreamRan = false;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'deliver', title: 'b', inputs: [{ from: 'a' }], params: {} },
    ]);
    await expect(runGraph(g, handlers({
      execute: async node => {
        if (node.id === 'a') return { status: 'failed', output: '', elapsedMs: 1, auditIds: [], error: '模型失败' };
        downstreamRan = true;
        return result(`out:${node.id}`);
      },
    }))).rejects.toThrow('执行失败');
    expect(downstreamRan).toBe(false);
  });

  it('onFail=abort 时真正中止，不允许"人工继续"默认绕过', async () => {
    let gateHandlerCalled = false;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }], params: { policy: 'quick' }, gate: { required: true, onFail: 'abort' } },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    await expect(runGraph(g, handlers({
      review: async () => result('review', rejectGate()),
      onGateFailure: async () => { gateHandlerCalled = true; return 'accept'; },
    }))).rejects.toThrow('onFail=abort');
    expect(gateHandlerCalled).toBe(false);
  });

  it('返工时 attempt 递增并传给执行器', async () => {
    const attempts: number[] = [];
    let reviewCount = 0;
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      {
        id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }], params: { policy: 'quick' },
        gate: { required: true, onFail: 'rework' }, loop: { id: 'l', target: 'a', maxIterations: 2 },
      },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    await runGraph(g, handlers({
      execute: async (node, _inputs, _fb, attempt) => {
        if (node.id === 'a') attempts.push(attempt ?? 0);
        return result(`out:${node.id}`);
      },
      review: async () => { reviewCount += 1; return result('review', reviewCount >= 2 ? passGate() : rejectGate()); },
      incrementCounter: () => 1,
    }));
    expect(attempts[0]).toBe(1);
    expect(attempts[1]).toBe(2);
  });
});

describe('v3.2：门禁结果在 onNodeDone 之前标准化', () => {
  it('缺少 gate 的门禁节点：onNodeDone 能拿到 default-deny 裁决', async () => {
    let savedGate: NodeResult['gate'];
    const g = graph([
      { id: 'a', capability: 'draft', title: 'a', inputs: [{ from: 'user' }], params: {} },
      { id: 'b', capability: 'review', title: 'b', inputs: [{ from: 'a' }], params: { policy: 'quick' }, gate: { required: true, onFail: 'pause' } },
      { id: 'c', capability: 'deliver', title: 'c', inputs: [{ from: 'b' }], params: {} },
    ]);
    await runGraph(g, handlers({
      review: async () => result('review'), // 故意不返回 gate
      onNodeDone: (node, res) => {
        if (node.id === 'b') savedGate = res.gate;
      },
      onGateFailure: async () => 'accept',
    }));
    expect(savedGate).toBeDefined();
    expect(savedGate?.verdict).toBe('reject');
    expect(savedGate?.degraded).toBe(true);
    expect(savedGate?.findings[0].desc).toContain('default-deny');
  });
});
