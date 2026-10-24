// ============================================================
// 回归单测：门禁判定、审核解析、计划校验、任务终态判定
// 覆盖场景（对应历次审计验收项）：
//   - API 失败/mock 不得通过真实门禁
//   - 审核文本"不通过"不得误判为通过（main 版回归项）
//   - 成功判定必须包含 done 阶段；demo 产出单独标记
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseReviewResult, validatePlan, computeTaskOutcome, sliceCodePointSafe } from '../Engine';
import { safeJsonParse } from '../llm';
import { assessDifficulty } from '../difficultyRouter';
import { createInitialState } from '../Pipeline';
import type { Agent, PipelineState } from '../types';

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
    const { valid, errors } = validatePlan([...fullPlan] as any);
    expect(valid).toBe(true);
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

describe('computeTaskOutcome（任务终态判定）', () => {
  function stateWith(
    stage: string,
    status: 'running' | 'done' | 'error',
    source: 'live' | 'demo' = 'live',
  ): PipelineState {
    const s = createInitialState();
    return {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        [stage]: {
          stage, agentId: 'a', agentName: 'A', department: 'develop',
          content: '', summary: '', status, source, elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
  }

  it('done 阶段完成且全部 live → completed', () => {
    const s = stateWith('develop', 'done');
    const s2 = {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        done: {
          stage: 'done', agentId: 'a', agentName: 'A', department: 'command',
          content: '', summary: '', status: 'done', source: 'live', elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
    expect(computeTaskOutcome(s2)).toBe('completed');
  });

  it('缺少 done 阶段 → incomplete（即使其他阶段都成功）', () => {
    expect(computeTaskOutcome(stateWith('develop', 'done'))).toBe('incomplete');
  });

  it('存在 error 阶段 → incomplete', () => {
    const s = stateWith('develop', 'error');
    const s2 = {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        done: {
          stage: 'done', agentId: 'a', agentName: 'A', department: 'command',
          content: '', summary: '', status: 'done', source: 'live', elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
    expect(computeTaskOutcome(s2)).toBe('incomplete');
  });

  it('含 demo 产出 → demo（不计入真实成功）', () => {
    const s = stateWith('develop', 'done', 'demo');
    const s2 = {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        done: {
          stage: 'done', agentId: 'a', agentName: 'A', department: 'command',
          content: '', summary: '', status: 'done', source: 'demo', elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
    expect(computeTaskOutcome(s2)).toBe('demo');
  });

  it('无任何阶段产出 → incomplete', () => {
    expect(computeTaskOutcome(createInitialState())).toBe('incomplete');
  });

  it('done 阶段非终态（running）→ incomplete（V2.0.2 回归项）', () => {
    const s = stateWith('develop', 'done');
    const s2 = {
      ...s,
      stageOutputs: {
        ...s.stageOutputs,
        done: {
          stage: 'done', agentId: 'a', agentName: 'A', department: 'command',
          content: '', summary: '', status: 'running', source: 'live', elapsedMs: 1,
          timestamp: new Date().toISOString(),
        },
      },
    } as PipelineState;
    expect(computeTaskOutcome(s2)).toBe('incomplete');
  });
});

describe('assessDifficulty（难度评估降级保护，V2.0.2）', () => {
  const noKeyAgent = { apiKey: '', department: 'command', role: 'leader' } as Agent;

  it('API 无 Key 降级：simple 判定提升为 medium（不得降低审核强度）', async () => {
    const r = await assessDifficulty('帮我快速修改一下这个格式', noKeyAgent, [], undefined);
    expect(r.degraded).toBe(true);
    expect(r.difficulty).toBe('medium');
    expect(r.enableReviewFramework).toBe(true);
  });

  it('API 无 Key 降级：complex 判定保持 complex', async () => {
    const r = await assessDifficulty('请做系统设计和多模块集成', noKeyAgent, [], undefined);
    expect(r.degraded).toBe(true);
    expect(r.difficulty).toBe('complex');
  });
});

describe('safeJsonParse（LLM JSON 容错，V2.0.3）', () => {
  it('单引号字符串 → 可解析', () => {
    const { success, value } = safeJsonParse<any>("{'result':'approved'}", null);
    expect(success).toBe(true);
    expect(value.result).toBe('approved');
  });

  it('undefined 值 → 解析为 null', () => {
    const { success, value } = safeJsonParse<any>('{"a": undefined}', null);
    expect(success).toBe(true);
    expect(value.a).toBeNull();
  });

  it('URL 里的 // 不被当注释吞掉', () => {
    const { success, value } = safeJsonParse<any>('{"url":"https://example.com"} // 注释', null);
    expect(success).toBe(true);
    expect(value.url).toBe('https://example.com');
  });
});

describe('sliceCodePointSafe（UTF-8 码点安全截断，V2.0.3）', () => {
  it('不在代理对中间切开 emoji', () => {
    const s = 'abc🎉def';
    // 从 emoji 两个码元中间切开也应返回合法字符串
    const cut = sliceCodePointSafe(s, 0, 4);
    expect(cut).toBe('abc');
    expect(Array.from(cut).length).toBe(3);
  });

  it('常规 ASCII 切片不受影响', () => {
    expect(sliceCodePointSafe('hello world', 0, 5)).toBe('hello');
  });
});
