// ============================================================
// v3 图运行时：通用调度器（拓扑执行 / 并发组 / 有界返工 / 门禁）
// 引擎只提供“节点执行器”，调度逻辑与具体能力解耦。
// ============================================================

import type { NodeResult, NodeSpec, TaskGraph } from './types';

export interface RuntimeHandlers {
  isAborted(): boolean;
  waitIfPaused(): Promise<void>;
  /** 执行非审查节点；feedback 用于返工时携带审查意见；attempt 为第几次执行（从 1 开始） */
  execute(node: NodeSpec, inputs: string[], feedback?: string, attempt?: number): Promise<NodeResult>;
  /** 执行审查节点；inputs 为被审节点输出 */
  review(node: NodeSpec, inputs: string[], feedback?: string, attempt?: number): Promise<NodeResult>;
  onNodeStart(node: NodeSpec): void;
  onNodeDone(node: NodeSpec, result: NodeResult): void;
  /** 门禁未通过且返工次数耗尽时调用；返回 accept 表示人工确认继续（须留痕） */
  onGateFailure(node: NodeSpec, result: NodeResult): Promise<'accept' | 'abort'>;
  /** 打回计数（返回累计值）；engine 用它驱动旧 UI 的计数器 */
  incrementCounter?(key?: 'contentRejectCount' | 'codeRejectCount'): number;
}

const MAX_STEPS = 400;
const MAX_REWORK_BEFORE_HUMAN = 3;

export async function runGraph(
  graph: TaskGraph,
  handlers: RuntimeHandlers,
): Promise<Record<string, NodeResult>> {
  const results: Record<string, NodeResult> = {};
  const done = new Set<string>();
  const pending = graph.nodes.slice();
  const order = new Map<string, number>(graph.nodes.map((node, i) => [node.id, i]));
  const attempts = new Map<string, number>();
  let steps = 0;

  while (pending.length > 0) {
    if (handlers.isAborted()) throw new DOMException('Aborted', 'AbortError');
    steps += 1;
    if (steps > MAX_STEPS) throw new Error(`任务图执行步数超限（>${MAX_STEPS}），可能存在无法满足的依赖`);
    await handlers.waitIfPaused();

    const ready = pending.filter(node =>
      node.inputs.every(input => {
        if (input.from === 'user') return true;
        if (!done.has(input.from)) return false;
        // 防御性检查：只允许依赖更早出现的节点（未过 GraphGuard 的图也不会乱序执行）
        return (order.get(input.from) ?? Infinity) < (order.get(node.id) ?? -1);
      }),
    );
    if (ready.length === 0) {
      throw new Error(`任务图依赖无法满足：剩余节点 ${pending.map(n => n.id).join(', ')} 存在环或缺失依赖`);
    }

    const first = ready[0];
    const batch = first.parallelGroup
      ? ready.filter(node => node.parallelGroup === first.parallelGroup)
      : [first];

    const batchResults = await Promise.all(
      batch.map(node => runNode(graph, node, results, handlers, attempts)),
    );

    batch.forEach((node, i) => {
      results[node.id] = batchResults[i];
      done.add(node.id);
      const idx = pending.indexOf(node);
      if (idx >= 0) pending.splice(idx, 1);
    });
  }

  return results;
}

async function runNode(
  graph: TaskGraph,
  node: NodeSpec,
  results: Record<string, NodeResult>,
  handlers: RuntimeHandlers,
  attempts: Map<string, number>,
): Promise<NodeResult> {
  handlers.onNodeStart(node);
  const inputs = resolveInputs(node, results);

  const nodeAttempt = (attempts.get(node.id) || 0) + 1;
  attempts.set(node.id, nodeAttempt);

  let result = node.capability === 'review'
    ? await handlers.review(node, inputs, undefined, nodeAttempt)
    : await handlers.execute(node, inputs, undefined, nodeAttempt);

  // v3.2：门禁结果必须在 onNodeDone 之前标准化。
  // 顺序错误会导致节点产出/审计里看不到 actual default-deny 结论。
  if (node.gate?.required && !result.gate) {
    result = {
      ...result,
      gate: {
        verdict: 'reject',
        findings: [{
          severity: 'high',
          category: 'quality',
          desc: '门禁节点缺少裁决结果（default-deny）',
          recommendation: '检查门禁执行器是否返回 gate；在修复前不得交付',
        }],
        degraded: true,
        rounds: 0,
        policyId: 'missing',
      },
    };
  }

  handlers.onNodeDone(node, result);

  // 节点执行失败（非门禁节点）：不得继续向下游传播
  if (result.status === 'failed' && !node.gate?.required) {
    throw new Error(`节点「${node.title}」执行失败，任务中止：${result.error || '未知错误'}`);
  }

  if (!node.gate?.required) return result;

  let verdict = result.gate?.verdict;

  // 有界返工：重跑 target → 重新审查；超过人工阈值就交给 onGateFailure
  const loop = node.loop;
  let attempt = 0;
  while (verdict !== 'pass' && loop && attempt < loop.maxIterations) {
    attempt += 1;
    const count = handlers.incrementCounter?.(loop.counterKey) ?? attempt;
    if (count > MAX_REWORK_BEFORE_HUMAN) break;

    const target = graph.nodes.find(x => x.id === loop.target);
    if (!target) break;

    const feedback = buildFeedback(result, attempt);
    const redoInputs = resolveInputs(target, results);
    const redoAttempt = (attempts.get(target.id) || 0) + 1;
    attempts.set(target.id, redoAttempt);
    const redo = await handlers.execute(target, redoInputs, feedback, redoAttempt);
    if (redo.status === 'failed') {
      throw new Error(`返工节点「${target.title}」执行失败：${redo.error || '未知错误'}`);
    }
    results[target.id] = redo;
    handlers.onNodeDone(target, redo);

    const reviewAttempt = (attempts.get(node.id) || 0) + 1;
    attempts.set(node.id, reviewAttempt);
    result = await handlers.review(node, resolveInputs(target, results), feedback, reviewAttempt);
    handlers.onNodeDone(node, result);
    verdict = result.gate?.verdict;
  }

  if (verdict !== 'pass') {
    // onFail: abort 必须真正中止，不允许被“人工继续”默认绕过
    if (node.gate?.onFail === 'abort') {
      throw new Error(`门禁未通过（onFail=abort）：${node.title}（${result.gate?.verdict || 'unknown'}）`);
    }
    const action = await handlers.onGateFailure(node, result);
    if (action === 'abort') {
      throw new Error(`门禁未通过：${node.title}（${result.gate?.verdict || 'unknown'}）`);
    }
    // accept：人工确认后继续（Engine 已留痕）
  }

  return result;
}

function resolveInputs(node: NodeSpec, results: Record<string, NodeResult>): string[] {
  return node.inputs.map(input => {
    if (input.from === 'user') return '';
    return results[input.from]?.output || '';
  });
}

function buildFeedback(result: NodeResult, attempt: number): string {
  const findings = (result.gate?.findings || [])
    .map(f => `[${f.severity}] ${f.desc}`)
    .join('；');
  return `审查未通过（第 ${attempt} 次返工）：${findings || result.gate?.verdict || '未通过'}`;
}
