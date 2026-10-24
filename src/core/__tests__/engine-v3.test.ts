import { describe, it, expect, afterEach } from 'vitest';
import { startPipelineV3, getState, stop, computeTaskOutcome, getEngineMode, preflightLiveMode } from '../Engine';
import { createAgents, DEFAULT_MODELS } from '../Pipeline';

afterEach(() => {
  try { stop(); } catch { /* ignore */ }
});

describe('v3 引擎：demo 模式端到端（无需 API Key）', () => {
  it('默认引擎模式为 v3（legacy 可通过 setEngineMode 回退）', () => {
    expect(getEngineMode()).toBe('v3');
  });

  it('简单任务：跑到 done，终态为 demo，无报错', async () => {
    await startPipelineV3('你好');
    const s = getState();
    expect(s.isRunning).toBe(false);
    expect(s.errors).toEqual([]);
    expect(s.difficulty).toBe('simple');
    expect(s.stage).toBe('done');
    expect(s.stageOutputs.done).toBeDefined();
    expect(computeTaskOutcome(s)).toBe('demo');
    expect(s.runMode).toBe('demo');
  }, 60000);

  it('中等任务（含代码信号）：走任务图，经过审查与校验，跑到 done', async () => {
    await startPipelineV3('请实现一个函数并写代码，给出完整代码与验证方法');
    const s = getState();
    expect(s.isRunning).toBe(false);
    expect(s.errors).toEqual([]);
    expect(s.difficulty).toBe('medium');
    expect(s.stage).toBe('done');
    expect(s.stageOutputs.done).toBeDefined();
    expect(s.reviewAuditCount).toBeGreaterThanOrEqual(1);
    expect(computeTaskOutcome(s)).toBe('demo');
  }, 90000);

  it('演示模式下复杂任务自动降为中等档（避免深度审计永远无法通过）', async () => {
    await startPipelineV3('请做系统设计和多模块集成，交付完整代码');
    const s = getState();
    expect(s.errors).toEqual([]);
    expect(s.difficulty).toBe('medium');
    expect(s.stage).toBe('done');
    expect(s.difficultyReason).toContain('演示模式');
  }, 90000);

  it('节点级输出：extract 与 research 各自独立，不互相覆盖', async () => {
    await startPipelineV3('请调研最新竞品资料并对比，再写一份实现方案');
    const s = getState();
    expect(s.errors).toEqual([]);
    expect(s.difficulty).toBe('medium');
    const caps = Object.values(s.nodeOutputs).map(o => o.capability);
    expect(caps).toContain('plan');
    expect(caps).toContain('extract');
    expect(caps).toContain('research');
    expect(caps).toContain('draft');
    expect(caps).toContain('deliver');
    // research 不会覆盖 extract 的旧阶段产出（stageOutputs 兼容层只有 extract）
    const researchOutputs = Object.values(s.nodeOutputs).filter(o => o.capability === 'research');
    const extractOutputs = Object.values(s.nodeOutputs).filter(o => o.capability === 'extract');
    expect(researchOutputs.length).toBe(1);
    expect(extractOutputs.length).toBe(1);
    expect(researchOutputs[0].nodeId).not.toBe(extractOutputs[0].nodeId);
    expect(s.stageOutputs.extract?.content).toBe(extractOutputs[0].content);
  }, 90000);

  it('节点级审计：每个节点有 auditIds，审查节点带 gate 结论', async () => {
    await startPipelineV3('请实现一个函数并写代码，给出完整代码与验证方法');
    const s = getState();
    expect(s.errors).toEqual([]);
    const outputs = Object.values(s.nodeOutputs);
    expect(outputs.length).toBeGreaterThanOrEqual(5);
    // demo 模式下 invoke 仍生成 auditId（只是标记 demo，不触网）
    expect(outputs.every(o => o.auditIds.length > 0)).toBe(true);
    const reviewOutputs = outputs.filter(o => o.capability === 'review');
    expect(reviewOutputs.length).toBeGreaterThanOrEqual(2);
    expect(reviewOutputs.every(o => Boolean(o.gate))).toBe(true);
    expect(reviewOutputs.every(o => o.status === 'demo')).toBe(true);
    // 审查裁决不应为 live pass（demo 来源不得作为真实通过）
    expect(reviewOutputs.some(o => o.gate?.degraded)).toBe(true);
  }, 90000);

  it('任务完成后状态可复用：再次启动会重置日志与产出', async () => {
    await startPipelineV3('你好');
    const first = getState();
    expect(first.stageOutputs.done).toBeDefined();
    await startPipelineV3('你好');
    const second = getState();
    expect(second.errors).toEqual([]);
    expect(second.log.length).toBeLessThan(300);
    expect(second.stage).toBe('done');
  }, 90000);
});

describe('v3.2：live 预检（fail-closed）', () => {
  it('demo 默认 Agent（未配 Key）→ live 预检失败并列出缺口', () => {
    const agents = createAgents();
    const pre = preflightLiveMode(agents, DEFAULT_MODELS);
    expect(pre.ok).toBe(false);
    expect(pre.issues.length).toBeGreaterThan(0);
    expect(pre.matrix.some(m => m.available.length === 0)).toBe(true);
  });

  it('部门都有 Key 且 provider 受支持 → 预检通过', () => {
    const agents = createAgents().map(a => ({ ...a, hasKey: true, model: 'deepseek-v3' }));
    const models = [{ id: 'deepseek-v3', name: 'DeepSeek-V3', provider: 'DeepSeek' }];
    const pre = preflightLiveMode(agents, models);
    expect(pre.ok).toBe(true);
    expect(pre.matrix.every(m => m.available.length > 0)).toBe(true);
  });

  it('provider 无默认端点 → 预检失败（不允许 live 启动后才发现）', () => {
    const agents = createAgents().map(a => ({ ...a, hasKey: true, model: 'hunyuan-hy3' }));
    const models = [{ id: 'hunyuan-hy3', name: 'Hunyuan', provider: '腾讯混元' }];
    const pre = preflightLiveMode(agents, models);
    expect(pre.ok).toBe(false);
    expect(pre.issues.some(i => i.reason.includes('无默认端点'))).toBe(true);
  });
});

describe('v3.2：上下文预算落盘到节点审计', () => {
  it('每个节点产出带有 contextInfo（估算 token / 截断记录）', async () => {
    await startPipelineV3('请调研最新竞品资料并对比，再写一份实现方案');
    const s = getState();
    expect(s.errors).toEqual([]);
    const llmCapabilities = new Set(['plan', 'extract', 'research', 'draft', 'deliver']);
    const outputs = Object.values(s.nodeOutputs).filter(o => llmCapabilities.has(o.capability));
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every(o => o.contextInfo !== undefined)).toBe(true);
    expect(outputs.every(o => (o.contextInfo?.estimatedTokens || 0) > 0)).toBe(true);
  }, 90000);
});
