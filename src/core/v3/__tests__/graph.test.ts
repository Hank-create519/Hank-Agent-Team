import { describe, it, expect } from 'vitest';
import { chooseGraph, validateGraph, simpleGraph, mediumGraph, complexGraph, detectSignals, describeGraph, estimateGraphCalls } from '../graph';
import type { TaskGraph, NodeSpec } from '../types';

function clone(graph: TaskGraph): TaskGraph {
  return JSON.parse(JSON.stringify(graph)) as TaskGraph;
}

describe('v3 GraphGuard：合法图通过', () => {
  it('三张默认模板都通过校验', () => {
    expect(validateGraph(simpleGraph('写一段自我介绍')).ok).toBe(true);
    expect(validateGraph(mediumGraph('写一份技术方案报告', detectSignals(''))).ok).toBe(true);
    expect(validateGraph(complexGraph('请做系统设计和多模块集成', detectSignals('请做系统设计和多模块集成'))).ok).toBe(true);
  });

  it('chooseGraph 按难度选择模板，且带风险等级', () => {
    expect(chooseGraph('你好', 'simple').risk).toBe('low');
    expect(chooseGraph('请写一份中等复杂度的报告', 'medium').risk).toBe('medium');
    expect(chooseGraph('请做系统设计和多模块集成', 'complex').risk).toBe('high');
  });

  it('信号识别：代码/研究/安全关键词会改变任务图节点', () => {
    const g1 = chooseGraph('请实现一个函数并写代码', 'medium');
    expect(g1.nodes.some(n => n.capability === 'verify')).toBe(true);
    const g2 = chooseGraph('请调研最新竞品资料并对比', 'medium');
    expect(g2.nodes.some(n => n.capability === 'research')).toBe(true);
    const g3 = chooseGraph('请做系统设计并检查安全与密钥权限', 'complex');
    expect(g3.nodes.some(n => n.capability === 'review' && n.params.kind === 'security')).toBe(true);
  });

  it('describeGraph 可读', () => {
    expect(describeGraph(simpleGraph('x'))).toContain('任务图');
  });
});

describe('v3 GraphGuard：非法图被拒绝（门禁不可绕过）', () => {
  it('交付节点缺少审查门禁依赖', () => {
    const g = clone(simpleGraph('写一段自我介绍'));
    g.nodes = g.nodes.filter(n => n.capability !== 'review');
    g.nodes.find(n => n.capability === 'deliver')!.inputs = [{ from: 'n1' }];
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('审查门禁');
  });

  it('审查节点未设置 gate', () => {
    const g = clone(simpleGraph('x'));
    const review = g.nodes.find(n => n.capability === 'review')!;
    delete review.gate;
    expect(validateGraph(g).ok).toBe(false);
  });

  it('未知审查策略', () => {
    const g = clone(simpleGraph('x'));
    const review = g.nodes.find(n => n.capability === 'review')!;
    review.params.policy = 'super-unsafe';
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('审查策略未知');
  });

  it('未知能力', () => {
    const g = clone(simpleGraph('x'));
    (g.nodes[0] as unknown as { capability: string }).capability = 'hack-the-gate';
    expect(validateGraph(g).ok).toBe(false);
  });

  it('依赖了更晚的节点（不允许反向依赖）', () => {
    const g = clone(simpleGraph('x'));
    (g.nodes[0] as NodeSpec).inputs = [{ from: 'n3' }];
    expect(validateGraph(g).ok).toBe(false);
  });

  it('依赖不存在的节点', () => {
    const g = clone(simpleGraph('x'));
    (g.nodes[0] as NodeSpec).inputs = [{ from: 'ghost' }];
    expect(validateGraph(g).ok).toBe(false);
  });

  it('循环次数越界', () => {
    const g = clone(simpleGraph('x'));
    const review = g.nodes.find(n => n.capability === 'review')!;
    review.loop = { id: 'l', target: 'n1', maxIterations: 9 };
    expect(validateGraph(g).ok).toBe(false);
  });

  it('高风险任务缺少 panel 审查或 verify', () => {
    const g = clone(complexGraph('请做系统设计', detectSignals('')));
    for (const n of g.nodes) {
      if (n.capability === 'review') n.params.policy = 'quick';
    }
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('panel');
  });

  it('节点数超限', () => {
    const g = clone(simpleGraph('x'));
    for (let i = 0; i < 25; i++) {
      g.nodes.push({ id: `extra_${i}`, capability: 'verify', title: 'x', inputs: [{ from: 'n1' }], params: {} });
    }
    expect(validateGraph(g).ok).toBe(false);
  });
});

describe('v3 GraphGuard：v3.1 新增约束', () => {
  it('返工目标不能是审查/交付节点', () => {
    const g = clone(mediumGraph('写一份报告', detectSignals('')));
    const review = g.nodes.find(n => n.capability === 'review')!;
    review.loop = { id: 'l', target: 'n7', maxIterations: 2 }; // n7 = deliver
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('返工目标');
  });

  it('门禁节点声明 onFail=rework 但没有 loop → 拒绝', () => {
    const g = clone(simpleGraph('x'));
    const review = g.nodes.find(n => n.capability === 'review')!;
    review.gate = { required: true, onFail: 'rework' };
    delete review.loop;
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('onFail=rework');
  });

  it('required gate 必须在交付节点的依赖链上（不能只挂一个孤立门禁）', () => {
    const g = clone(mediumGraph('写一份报告', detectSignals('')));
    // 新增一个与交付无关的审查门禁
    g.nodes.splice(g.nodes.length - 1, 0, {
      id: 'orphan-review', capability: 'review', title: '孤立审查',
      inputs: [{ from: 'n1' }], params: { policy: 'standard' },
      gate: { required: true, onFail: 'pause' },
    });
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('不在交付节点的依赖链上');
  });

  it('高风险任务必须有 verify 门禁节点', () => {
    const g = clone(complexGraph('请做系统设计', detectSignals('')));
    for (const n of g.nodes) {
      if (n.capability === 'verify') delete n.gate;
    }
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('verify 门禁');
  });

  it('任务图深度超限 → 拒绝', () => {
    const nodes: NodeSpec[] = Array.from({ length: 14 }, (_, i) => ({
      id: `d${i}`,
      capability: 'draft',
      title: `d${i}`,
      inputs: i === 0 ? [{ from: 'user' }] : [{ from: `d${i - 1}` }],
      params: {},
    }));
    nodes.push({ id: 'deliver', capability: 'deliver', title: '交付', inputs: [{ from: 'd13' }], params: {} });
    const g: TaskGraph = { version: 1, goal: 'x', risk: 'low', nodes, deliverableNodeId: 'deliver', source: 'template' };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('深度超限');
  });

  it('预计调用次数超限 → 拒绝', () => {
    // panel 审查最坏调用 12 次；6 个 panel 门禁 + 3 轮返工 → 最坏估算远超上限
    const nodes: NodeSpec[] = [
      { id: 'plan', capability: 'plan', title: '方案', inputs: [{ from: 'user' }], params: {} },
      { id: 'draft', capability: 'draft', title: '产出', inputs: [{ from: 'plan' }], params: {} },
    ];
    for (let i = 0; i < 6; i++) {
      nodes.push({
        id: `r${i}`, capability: 'review', title: `审查${i}`, inputs: [{ from: 'draft' }],
        params: { policy: 'panel' }, gate: { required: true, onFail: 'rework' },
        loop: { id: `lr${i}`, target: 'draft', maxIterations: 3 },
      });
    }
    nodes.push({
      id: 'deliver', capability: 'deliver', title: '交付',
      inputs: nodes.filter(n => n.capability === 'review').map(n => ({ from: n.id })), params: {},
    });
    const g: TaskGraph = { version: 1, goal: 'x', risk: 'medium', nodes, deliverableNodeId: 'deliver', source: 'template' };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('调用估算超限');
  });
});

describe('v3.2：verify 门禁依赖与预算估算', () => {
  it('中等代码任务的 verify 必须是交付祖先（模板已修正）', () => {
    const g = mediumGraph('请实现一个函数并写代码', detectSignals('请实现一个函数并写代码'));
    const verifyNode = g.nodes.find(n => n.capability === 'verify');
    const deliver = g.nodes.find(n => n.id === g.deliverableNodeId)!;
    expect(verifyNode).toBeDefined();
    expect(deliver.inputs.some(i => i.from === verifyNode!.id)).toBe(true);
    expect(validateGraph(g).ok).toBe(true);
  });

  it('verify 门禁不在交付链上 → 拒绝（不限高风险）', () => {
    const g = clone(mediumGraph('请实现一个函数并写代码', detectSignals('请实现一个函数并写代码')));
    const deliver = g.nodes.find(n => n.id === g.deliverableNodeId)!;
    deliver.inputs = deliver.inputs.filter(i => !i.from.startsWith('n6b'));
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('；')).toContain('verify 门禁');
  });

  it('预算估算使用 ReviewPolicy.maxCalls（panel 远比节点数贵）', () => {
    const g = complexGraph('请做系统设计并检查安全问题', detectSignals('请做系统设计并检查安全问题'));
    const estimated = estimateGraphCalls(g);
    expect(estimated).toBeGreaterThan(g.nodes.length);
    // panel maxCalls=12，至少一个 panel 审查节点 → 估算应大于 12
    expect(estimated).toBeGreaterThanOrEqual(12);
  });

  it('默认任务图使用并发组（extract 与 research 并行）', () => {
    const g = mediumGraph('请调研资料并写报告', detectSignals('请调研资料并写报告'));
    const grouped = g.nodes.filter(n => n.parallelGroup === 'g1');
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    expect(grouped.map(n => n.capability).sort()).toEqual(['extract', 'research']);
  });
});
