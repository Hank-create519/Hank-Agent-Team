import { describe, it, expect } from 'vitest';
import { buildContext, approximateTokens, sliceCodePointSafe, type ContextSource } from '../context';

function src(id: string, content: string, priority = 20): ContextSource {
  return { id, label: `来源-${id}`, content, priority };
}

describe('ContextBuilder（v3.2）：上下文预算与截断', () => {
  it('token 估算：中文按 1 字≈1 token，英文约 4 字符≈1 token', () => {
    expect(approximateTokens('你好世界')).toBe(4);
    expect(approximateTokens('abcdefgh')).toBe(2);
  });

  it('预算内：全部保留，不产生截断记录', () => {
    const r = buildContext([src('a', '这是第一份材料。'), src('b', '这是第二份材料。')], { tokenBudget: 1000 });
    expect(r.truncated).toEqual([]);
    expect(r.text).toContain('这是第一份材料');
    expect(r.text).toContain('这是第二份材料');
  });

  it('超预算：按优先级保留，低优先级被截断并记录原因', () => {
    const long = '重要内容。'.repeat(2000); // 约 10000 tokens
    const r = buildContext([src('goal', '用户目标', 100), src('big', long, 10)], { tokenBudget: 500 });
    expect(r.estimatedTokens).toBeLessThanOrEqual(600);
    // 用户目标（短、高优先级）应完整保留
    expect(r.text).toContain('用户目标');
    const truncated = r.truncated.find(t => t.id === 'big');
    expect(truncated).toBeDefined();
    expect(['budget', 'single-share']).toContain(truncated?.reason);
    expect(truncated!.keptChars).toBeLessThan(long.length);
  });

  it('单来源份额上限：一个超长来源不能挤掉其他来源', () => {
    const huge = 'A'.repeat(50000);
    const r = buildContext([
      src('huge', huge, 100),
      src('second', '第二份关键材料', 50),
    ], { tokenBudget: 2000, maxSingleShare: 0.5 });
    expect(r.text).toContain('第二份关键材料');
    expect(r.truncated.some(t => t.id === 'huge' && t.reason === 'single-share')).toBe(true);
  });

  it('去重：相同内容只保留一份', () => {
    const dup = '完全相同的材料内容，用于测试去重。';
    const r = buildContext([src('a', dup, 100), src('b', dup, 50)], { tokenBudget: 1000 });
    expect(r.truncated.some(t => t.reason === 'duplicate')).toBe(true);
    expect(r.text.split(dup).length - 1).toBe(1);
  });

  it('码点安全截断：不切开 emoji 代理对', () => {
    const s = '😀😀😀😀😀';
    const cut = sliceCodePointSafe(s, 0, 3);
    expect(cut.length % 2).toBe(0);
    expect(cut).not.toContain('\uFFFD');
  });

  it('空来源被忽略', () => {
    const r = buildContext([src('empty', '   ')], { tokenBudget: 100 });
    expect(r.text).toBe('');
    expect(r.truncated).toEqual([]);
  });
});
