import { describe, it, expect } from 'vitest';
import { evaluateVerify } from '../verify';

describe('verify（v3.2）：真实可判定的确定性校验', () => {
  it('nonempty：短内容拒绝', () => {
    expect(evaluateVerify({ checks: ['nonempty'], content: '短' }).ok).toBe(false);
    expect(evaluateVerify({ checks: ['nonempty'], content: '这个产出足够长，超过二十个字符的阈值。', minChars: 10 }).ok).toBe(true);
  });

  it('strict-json：包含 { } 的普通文本/代码片段不算通过', () => {
    const codeLike = '以下是代码：\nfunction f() { return { a: 1 }; }';
    const r = evaluateVerify({ checks: ['strict-json'], content: codeLike });
    expect(r.ok).toBe(false);
    expect(r.results[0].reason).toContain('不是严格 JSON');
  });

  it('strict-json：合法 JSON object 通过', () => {
    const r = evaluateVerify({ checks: ['strict-json'], content: '{ "summary": "ok", "risks": [] }' });
    expect(r.ok).toBe(true);
  });

  it('strict-json：顶层数组拒绝（必须是 object）', () => {
    const r = evaluateVerify({ checks: ['strict-json'], content: '[1,2,3]' });
    expect(r.ok).toBe(false);
  });

  it('strict-json：expectedKeys 最小 schema 校验', () => {
    const ok = evaluateVerify({
      checks: ['strict-json'],
      content: '{"plan":"x","steps":[]}',
      expectedKeys: ['plan', 'steps'],
    });
    expect(ok.ok).toBe(true);
    const missing = evaluateVerify({
      checks: ['strict-json'],
      content: '{"plan":"x"}',
      expectedKeys: ['plan', 'steps'],
    });
    expect(missing.ok).toBe(false);
    expect(missing.results[0].reason).toContain('缺少必需字段');
  });

  it('live-source：demo 来源在 live 任务中不通过', () => {
    expect(evaluateVerify({ checks: ['live-source'], content: 'x', liveSourceOk: false }).ok).toBe(false);
    expect(evaluateVerify({ checks: ['live-source'], content: 'x', liveSourceOk: true }).ok).toBe(true);
  });

  it('未知校验项 default-deny（不静默跳过）', () => {
    const r = evaluateVerify({ checks: ['nonempty', 'hack-check'], content: '这个产出足够长，超过二十个字符的阈值。', minChars: 10 });
    expect(r.ok).toBe(false);
    expect(r.results.some(x => x.kind === 'hack-check' && x.reason?.includes('未知校验项'))).toBe(true);
  });
});
