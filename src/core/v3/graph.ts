// ============================================================
// v3 任务图：能力元数据 / 默认模板 / 启发式规划 / 确定性校验（GraphGuard）
// “灵活”不等于“失控”：任何图在执行前必须通过 validateGraph。
// ============================================================

import type { PipelineStage } from '../types';
import type { CapabilityId, NodeSpec, TaskGraph } from './types';
import { REVIEW_POLICIES } from './review';

export interface CapabilityMeta {
  label: string;
  /** UI 兼容：映射到旧阶段标签（review/verify 不设 legacy stage） */
  legacyStage: PipelineStage | null;
  /** ContextBuilder 上下文 token 预算（近似；防止 Prompt 膨胀） */
  contextTokens: number;
}

export const CAPABILITY_META: Record<CapabilityId, CapabilityMeta> = {
  plan: { label: '制定方案', legacyStage: 'init', contextTokens: 1200 },
  extract: { label: '信息提取', legacyStage: 'extract', contextTokens: 1800 },
  research: { label: '资料检索', legacyStage: 'extract', contextTokens: 1800 },
  draft: { label: '产出实现', legacyStage: 'develop', contextTokens: 2600 },
  review: { label: '审查把关', legacyStage: null, contextTokens: 2400 },
  verify: { label: '确定性校验', legacyStage: null, contextTokens: 400 },
  deliver: { label: '完成交付', legacyStage: 'done', contextTokens: 2000 },
};

export type DifficultyLike = 'simple' | 'medium' | 'complex';

interface Signals {
  research: boolean;
  code: boolean;
  security: boolean;
}

const RESEARCH_RE = /研究|调研|资料|查一下|最新|对比|竞品|市场|搜索|引用|文献/i;
const CODE_RE = /代码|仓库|实现|函数|脚本|bug|修复|重构|接口|项目|程序/i;
const SECURITY_RE = /安全|越权|注入|密钥|权限|审计|隐私|合规|漏洞/i;

export function detectSignals(goal: string): Signals {
  return {
    research: RESEARCH_RE.test(goal),
    code: CODE_RE.test(goal),
    security: SECURITY_RE.test(goal),
  };
}

function n(id: string, capability: CapabilityId, title: string, inputs: NodeSpec['inputs'], params: Record<string, unknown> = {}): NodeSpec {
  return { id, capability, title, inputs, params };
}

function reviewNode(
  id: string,
  title: string,
  target: string,
  policy: 'quick' | 'standard' | 'panel',
  opts: { kind?: string; gate?: boolean; loop?: { max: number; counterKey?: 'contentRejectCount' | 'codeRejectCount' } } = {},
): NodeSpec {
  const node = n(id, 'review', title, [{ from: target }], { policy, kind: opts.kind || 'general', targetLabel: title });
  if (opts.gate !== false) {
    node.gate = { required: true, onFail: opts.loop ? 'rework' : 'pause' };
  }
  if (opts.loop) {
    node.loop = {
      id: `loop_${id}`,
      target,
      maxIterations: opts.loop.max,
      counterKey: opts.loop.counterKey,
    };
  }
  return node;
}

// ---------------- 默认模板（规划失败/无需规划时使用） ----------------

export function simpleGraph(goal: string): TaskGraph {
  return {
    version: 1,
    goal,
    risk: 'low',
    source: 'template',
    nodes: [
      n('n1', 'draft', '直接产出', [{ from: 'user' }], { brief: '直接完成用户需求' }),
      reviewNode('n2', '快速审查', 'n1', 'quick', { kind: 'content', loop: { max: 2, counterKey: 'codeRejectCount' } }),
      n('n3', 'deliver', '交付', [{ from: 'n2' }], {}),
    ],
    deliverableNodeId: 'n3',
  };
}

export function mediumGraph(goal: string, signals: Signals): TaskGraph {
  // n3 extract 与 n3b research 在 plan 后并发（parallelGroup），再进入审核与产出。
  const nodes: NodeSpec[] = [
    n('n1', 'plan', '制定方案', [{ from: 'user' }], {}),
    reviewNode('n2', '方案审查', 'n1', 'standard', { kind: 'plan', loop: { max: 2 } }),
    { ...n('n3', 'extract', '信息提取', [{ from: 'user' }, { from: 'n1' }], {}), parallelGroup: 'g1' },
  ];
  if (signals.research) {
    nodes.push({ ...n('n3b', 'research', '资料检索', [{ from: 'n1' }], {}), parallelGroup: 'g1' });
  }
  nodes.push(
    reviewNode('n4', '内容审核', 'n3', 'quick', {
      kind: 'content',
      loop: { max: 3, counterKey: 'contentRejectCount' },
    }),
    n('n5', 'draft', '实现产出', [
      { from: 'n1' },
      { from: 'n3' },
      ...(signals.research ? [{ from: 'n3b' }] : []),
    ], {}),
    reviewNode('n6', '代码审核', 'n5', 'standard', {
      kind: 'code',
      loop: { max: 3, counterKey: 'codeRejectCount' },
    }),
  );
  const deliverInputs: NodeSpec['inputs'] = [{ from: 'n2' }, { from: 'n4' }, { from: 'n6' }];
  if (signals.code) {
    // 确定性校验：只做真实可判定的检查（严格 JSON 仅在上游要求结构化输出时启用）
    const verifyNode = n('n6b', 'verify', '确定性校验', [{ from: 'n5' }], {
      checks: ['nonempty', 'live-source'],
    });
    verifyNode.gate = { required: true, onFail: 'pause' };
    nodes.push(verifyNode);
    deliverInputs.push({ from: 'n6b' });
  }
  nodes.push(n('n7', 'deliver', '完成交付', deliverInputs, {}));
  return { version: 1, goal, risk: 'medium', source: 'template', nodes, deliverableNodeId: 'n7' };
}

export function complexGraph(goal: string, signals: Signals): TaskGraph {
  const nodes: NodeSpec[] = [
    n('n1', 'plan', '制定方案', [{ from: 'user' }], {}),
    reviewNode('n2', '方案深度审查', 'n1', 'panel', { kind: 'plan', loop: { max: 2 } }),
    { ...n('n3', 'extract', '信息提取', [{ from: 'user' }, { from: 'n1' }], {}), parallelGroup: 'g1' },
    { ...n('n3b', 'research', '资料检索', [{ from: 'n1' }], {}), parallelGroup: 'g1' },
    n('n4', 'draft', '实现产出', [{ from: 'n1' }, { from: 'n3' }, { from: 'n3b' }], {}),
    reviewNode('n5', '内容审核', 'n3', 'standard', {
      kind: 'content',
      loop: { max: 3, counterKey: 'contentRejectCount' },
    }),
    reviewNode('n6', '代码深度审查', 'n4', 'panel', {
      kind: 'code',
      loop: { max: 3, counterKey: 'codeRejectCount' },
    }),
  ];
  const deliverInputs: NodeSpec['inputs'] = [
    { from: 'n2' }, { from: 'n5' }, { from: 'n6' },
  ];
  const verifyNode = n('n7', 'verify', '确定性校验', [{ from: 'n4' }], { checks: ['nonempty', 'live-source'] });
  verifyNode.gate = { required: true, onFail: 'pause' };
  nodes.push(verifyNode);
  deliverInputs.push({ from: 'n7' });

  if (signals.security) {
    // 高风险管理：追加一次安全专项审查（策略可配置，不改引擎）
    const securityReview = reviewNode('n6b', '安全专项审查', 'n4', 'panel', { kind: 'security' });
    nodes.push(securityReview);
    deliverInputs.push({ from: 'n6b' });
  }
  nodes.push(n('n8', 'deliver', '完成交付', deliverInputs, {}));
  return { version: 1, goal, risk: 'high', source: 'template', nodes, deliverableNodeId: 'n8' };
}

/**
 * 图的最坏情况调用估算（v3.2）：
 *   - review 节点的成本来自 ReviewPolicy.maxCalls（快审/标准/面板不同）；
 *   - 返工按 maxIterations × (目标节点成本 + 复审成本) 计入；
 *   - 用于 GraphGuard 与启动前预算预检，避免“节点数+循环数”严重低估。
 */
export function estimateGraphCalls(graph: TaskGraph): number {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const costOf = (node: NodeSpec, depth = 0): number => {
    if (depth > 3) return 2; // 防御性上限：异常图不会被无限递归
    let cost = CAPABILITY_CALL_COST[node.capability];
    if (node.capability === 'review') {
      const policy = REVIEW_POLICIES[String(node.params?.policy || 'standard')];
      cost = policy?.maxCalls ?? 4;
    }
    if (node.loop) {
      const target = byId.get(node.loop.target);
      const targetCost = target ? costOf(target, depth + 1) : 1;
      const reviewCost = node.capability === 'review' ? (REVIEW_POLICIES[String(node.params?.policy || 'standard')]?.maxCalls ?? 4) : 0;
      cost += node.loop.maxIterations * (targetCost + reviewCost);
    }
    return cost;
  };
  return graph.nodes.reduce((sum, node) => sum + costOf(node), 0);
}

const CAPABILITY_CALL_COST: Record<CapabilityId, number> = {
  plan: 1, extract: 1, research: 1, draft: 1, review: 0, verify: 0, deliver: 1,
};

/**
 * 启发式规划：按输入信号决定需要哪些能力/审查节点。
 * 这是“可审计的确定性规划”——同样的输入得到同样的图；
 * 后续可把本函数替换为 LLM 规划器（输出需过同一个 GraphGuard）。
 */
export function chooseGraph(goal: string, difficulty: DifficultyLike): TaskGraph {
  const signals = detectSignals(goal);
  if (difficulty === 'simple') return simpleGraph(goal);
  if (difficulty === 'medium') return mediumGraph(goal, signals);
  return complexGraph(goal, signals);
}

// ---------------- GraphGuard：确定性校验 ----------------

export interface GraphGuardResult {
  ok: boolean;
  errors: string[];
}

const MAX_NODES = 20;
/** 图最坏情况调用上限（任务总预算 240 的一部分，为运行时重试/人工预留） */
const MAX_GRAPH_ESTIMATED_CALLS = 160;

export function validateGraph(graph: TaskGraph): GraphGuardResult {
  const errors: string[] = [];
  if (graph.version !== 1) errors.push('未知任务图版本');
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { ok: false, errors: [...errors, '任务图节点为空'] };
  }
  if (graph.nodes.length > MAX_NODES) errors.push(`节点数超限（${graph.nodes.length} > ${MAX_NODES}）`);

  const index = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    if (index.has(node.id)) errors.push(`节点 id 重复：${node.id}`);
    index.set(node.id, i);
    if (!CAPABILITY_META[node.capability]) errors.push(`节点 ${node.id} 能力未知：${node.capability}`);
    if (node.capability === 'review') {
      const policy = String(node.params?.policy || '');
      if (!REVIEW_POLICIES[policy]) errors.push(`节点 ${node.id} 审查策略未知：${policy || '(空)'}`);
      if (!node.gate?.required) errors.push(`节点 ${node.id} 是审查节点但未设为门禁（gate.required）`);
    }
    for (const input of node.inputs) {
      if (input.from === 'user') continue;
      const at = index.get(input.from);
      if (at === undefined) errors.push(`节点 ${node.id} 依赖不存在的节点：${input.from}`);
      else if (at >= i) errors.push(`节点 ${node.id} 依赖了未先执行的节点：${input.from}（只允许依赖更早节点）`);
    }
    if (node.loop) {
      if (node.loop.maxIterations < 1 || node.loop.maxIterations > 3) errors.push(`节点 ${node.id} 循环次数越界（1—3）`);
      const targetAt = index.get(node.loop.target);
      if (targetAt === undefined || targetAt >= i) errors.push(`节点 ${node.id} 返工目标非法：${node.loop.target}`);
    }
  });

  // ---------- 依赖可达性：required gate 必须是交付节点的祖先 ----------
  const ancestorCache = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const ancestorsOf = (nodeId: string): Set<string> => {
    if (ancestorCache.has(nodeId)) return ancestorCache.get(nodeId)!;
    const set = new Set<string>();
    // 防环：非法图（环）也可能进到这里，不能无限递归；环由后续依赖校验报错
    if (visiting.has(nodeId)) return set;
    visiting.add(nodeId);
    const node = graph.nodes.find(x => x.id === nodeId);
    if (node) {
      for (const input of node.inputs) {
        if (input.from === 'user') continue;
        set.add(input.from);
        for (const a of ancestorsOf(input.from)) set.add(a);
      }
    }
    visiting.delete(nodeId);
    ancestorCache.set(nodeId, set);
    return set;
  };

  const deliver = graph.nodes.find(x => x.id === graph.deliverableNodeId);
  if (!deliver) {
    errors.push('缺少交付节点');
  } else {
    if (deliver.capability !== 'deliver') errors.push('交付节点能力必须为 deliver');
    const deliverAncestors = ancestorsOf(deliver.id);
    const requiredGates = graph.nodes.filter(x => x.capability === 'review' && x.gate?.required);
    for (const gate4 of requiredGates) {
      if (!deliverAncestors.has(gate4.id)) {
        errors.push(`审查门禁「${gate4.id}」不在交付节点的依赖链上（门禁必须成为交付的祖先）`);
      }
    }
    // v3.2：所有 required verify 门禁也必须成为交付祖先（不限高风险）
    const requiredVerifyGates = graph.nodes.filter(x => x.capability === 'verify' && x.gate?.required);
    for (const vg of requiredVerifyGates) {
      if (!deliverAncestors.has(vg.id)) {
        errors.push(`verify 门禁「${vg.id}」不在交付节点的依赖链上（校验必须成为交付的祖先）`);
      }
    }
  }

  // ---------- 循环/返工约束 ----------
  for (const node of graph.nodes) {
    if (!node.loop) continue;
    if (node.gate?.required && node.gate.onFail === 'rework' && !node.loop) {
      // 已由 loop 存在性保证，占位：保持规则显式
    }
    const target = graph.nodes.find(x => x.id === node.loop!.target);
    if (target && (target.capability === 'review' || target.capability === 'deliver')) {
      errors.push(`节点 ${node.id} 的返工目标不能是审查/交付节点：${target.id}`);
    }
  }
  for (const node of graph.nodes) {
    if (node.gate?.required && node.gate.onFail === 'rework' && !node.loop) {
      errors.push(`门禁节点 ${node.id} 声明 onFail=rework 但没有 loop（无法返工，会直接卡死）`);
    }
  }

  // ---------- 图深度（最长链）与预算估计 ----------
  const depthCache = new Map<string, number>();
  const depthVisiting = new Set<string>();
  const depthOf = (nodeId: string): number => {
    if (depthCache.has(nodeId)) return depthCache.get(nodeId)!;
    if (depthVisiting.has(nodeId)) return 1; // 防环：环由依赖校验报错
    depthVisiting.add(nodeId);
    const node = graph.nodes.find(x => x.id === nodeId);
    if (!node) {
      depthVisiting.delete(nodeId);
      return 0;
    }
    const deps = node.inputs.filter(i => i.from !== 'user').map(i => depthOf(i.from));
    const depth = 1 + (deps.length ? Math.max(...deps) : 0);
    depthVisiting.delete(nodeId);
    depthCache.set(nodeId, depth);
    return depth;
  };
  const depth = Math.max(...graph.nodes.map(x => depthOf(x.id)));
  if (depth > 12) errors.push(`任务图深度超限（${depth} > 12）`);
  const estimatedCalls = estimateGraphCalls(graph);
  if (estimatedCalls > MAX_GRAPH_ESTIMATED_CALLS) {
    errors.push(`任务图最坏情况调用估算超限（${estimatedCalls} > ${MAX_GRAPH_ESTIMATED_CALLS}）`);
  }

  // ---------- 风险等级门禁要求 ----------
  const gatePolicies = graph.nodes
    .filter(x => x.capability === 'review' && x.gate?.required)
    .map(x => String(x.params?.policy || ''));
  if (graph.risk === 'low' && gatePolicies.length < 1) errors.push('低风险任务至少需要 1 个审查门禁');
  if (graph.risk === 'medium' && !gatePolicies.some(p => p === 'standard' || p === 'panel')) {
    errors.push('中风险任务至少需要 1 个 standard/panel 审查门禁');
  }
  if (graph.risk === 'high') {
    if (!gatePolicies.some(p => p === 'panel')) errors.push('高风险任务至少需要 1 个 panel 审查门禁');
    const verifyGates = graph.nodes.filter(x => x.capability === 'verify' && x.gate?.required);
    if (verifyGates.length === 0) errors.push('高风险任务必须包含一个 verify 门禁节点（确定性校验）');
    if (deliver) {
      const deliverAncestors = ancestorsOf(deliver.id);
      for (const verifyGate of verifyGates) {
        if (!deliverAncestors.has(verifyGate.id)) errors.push(`verify 门禁「${verifyGate.id}」不在交付依赖链上`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function describeGraph(graph: TaskGraph): string {
  const chain = graph.nodes.map(x => `${x.id}:${CAPABILITY_META[x.capability]?.label || x.capability}`).join(' → ');
  return `任务图（${graph.risk} 风险 · ${graph.nodes.length} 节点）：${chain}`;
}
