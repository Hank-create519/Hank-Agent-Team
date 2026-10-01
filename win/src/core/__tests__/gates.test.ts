// ============================================================
// 阶段 0 回归单测：门禁判定、审核解析、计划校验、成功判定
// 场景对照（阶段0修复验收）：
//   - API 失败/mock 不得通过门禁
//   - 审核文本"不通过"不得误判为通过
//   - 暂停恢复不绕过失败（由 Engine 恢复重试语义保证，此处测纯函数部分）
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseReviewResult, validatePlan, computeTaskSuccess } from '../Engine';
import { createInitialState } from '../Pipeline';
import type { PipelineState } from '../types';

describe('parseReviewResult（审核打回判定）', () => {
  it('JSON 结论 approved → 通过', () => {
    const r = parseReviewResult('分析如下……\n{"result":"approved","issues":[]}');
    expect(r.approved).toBe(true);
  });

  it('JSON 结论 rejected → 打回，并带 issues', () => {
    const r = parseReviewResult('{"result":"rejected","issues":["缺少错误处理"]}');
    expect(r.approved).toBe(false);
    expect(r.issues).toContain('缺少错误处理');
  });

  it('"不通过" 文本不得误判为通过（main 版回归项）', () => {
    const r = parseReviewResult('审核结论：不通过。原因：存在安全漏洞。');
    expect(r.approved).toBe(false);
  });

  it('"驳回" 文本 → 打回', () => {
    const r = parseReviewResult('❌ 驳回，理由：边界条件未覆盖');
    expect(r.approved).toBe(false);
  });

  it('显式通过文本 → 通过', () => {
    const r = parseReviewResult('最终结论：通过');
    expect(r.approved).toBe(true);
  });

  it('无明确结论 → default-deny 打回', () => {
    const r = parseReviewResult('整体还行，某些地方可以再改改。');
    expect(r.approved).toBe(false);
  });

  it('JSON 里 issues 非数组时不崩溃', () => {
    const r = parseReviewResult('{"result":"approved","issues":"无"}');
    expect(r.approved).toBe(true);
    expect(Array.isArray(r.issues)).toBe(true);
  });
});

describe('validatePlan（ConstitutionGuard）', () => {
  const fullPlan = ['extract', 'content_review', 'develop', 'code_review', 'deep_audit', 'deploy', 'done'];

  it('完整计划通过', () => {
    const before = JSON.stringify(fullPlan);
    const { valid, errors } = validatePlan([...fullPlan] as any);
    expect(valid).toBe(true);
    expect(JSON.stringify(fullPlan)).toBe(before);
    expect(errors).toHaveLength(0);
  });

  it('缺少 done 阶段 → 拒绝', () => {
    const { valid } = validatePlan(['extract', 'content_review', 'develop', 'code_review', 'deploy'] as any);
    expect(valid).toBe(false);
  });

  it('缺少 content_review → 拒绝', () => {
    const { valid } = validatePlan(['extract', 'develop', 'code_review', 'deploy', 'done'] as any);
    expect(valid).toBe(false);
  });

  it('阶段顺序错误 → 拒绝', () => {
    const { valid } = validatePlan(['develop', 'extract', 'content_review', 'code_review', 'deploy', 'done'] as any);
    expect(valid).toBe(false);
  });

  it('包含未知阶段 → 拒绝', () => {
    const { valid } = validatePlan(['extract', 'content_review', 'develop', 'code_review', 'deploy', 'done', 'hack_stage'] as any);
    expect(valid).toBe(false);
  });

  it('空计划 / 非数组 → 拒绝', () => {
    expect(validatePlan([] as any).valid).toBe(false);
    expect(validatePlan(null as any).valid).toBe(false);
  });
});

describe('computeTaskSuccess（任务成功判定，替代 errors.length）', () => {
  function stateWith(stage: string, status: 'running' | 'done' | 'error'): PipelineState {
    const s = createInitialState();
    return {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        [stage]: {
          stage, agentId: 'a', agentName: 'A', department: 'develop',
          content: '', summary: '', status, source: 'live', elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
  }

  it('全部阶段 done → 成功', () => {
    expect(computeTaskSuccess(stateWith('develop', 'done'))).toBe(true);
  });

  it('存在 error 阶段 → 失败（即使 errors 数组为空）', () => {
    expect(computeTaskSuccess(stateWith('develop', 'error'))).toBe(false);
  });

  it('无任何阶段产出 → 不算成功', () => {
    expect(computeTaskSuccess(createInitialState())).toBe(false);
  });
});
