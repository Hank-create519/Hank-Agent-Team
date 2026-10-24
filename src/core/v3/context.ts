// ============================================================
// ContextBuilder（v3.2）：统一的上下文装配与预算控制
//
// 问题：draft/deliver 直接拼接上游全部输出 → Prompt 膨胀、成本失控、质量下降。
// 方案：
//   1) 每个节点声明 token 预算（调用方传入）；
//   2) 按来源优先级排序（用户目标 > 已过门禁的产出 > 早先节点）；
//   3) 超预算时按“头 + 尾”安全截断（码点安全），并记录截断原因；
//   4) 去重：相同内容只保留一份；
//   5) 返回结构化结果，供审计记录（截断来源、原始/输出字符数）。
// ============================================================

export interface ContextSource {
  /** 来源标识（nodeId / 'user' / 'task'） */
  id: string;
  /** 人类可读标签（节点标题） */
  label: string;
  content: string;
  /** 优先级：数字越大越优先保留（用户目标=100，门禁通过产出=50，普通产出=20） */
  priority: number;
}

export interface ContextBuildOptions {
  /** 输出 token 预算（近似值；中文约 1 字/token，英文约 4 字符/token） */
  tokenBudget: number;
  /** 单个来源最多占预算比例（默认 0.6，避免一个长文档挤掉其他来源） */
  maxSingleShare?: number;
}

export interface ContextBuildResult {
  text: string;
  usedChars: number;
  estimatedTokens: number;
  truncated: Array<{ id: string; label: string; originalChars: number; keptChars: number; reason: 'budget' | 'single-share' | 'duplicate' }>;
}

/** 粗略 token 估算：CJK 1 字≈1 token，其余 4 字符≈1 token（只用于预算保护，不做计费） */
export function approximateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1;
    else if (code >= 0xac00 && code <= 0xd7af) cjk += 1;
    else if (code >= 0xf900 && code <= 0xfaff) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/** 码点安全截断：保留头部 + 尾部，避免切开代理对 */
export function sliceCodePointSafe(str: string, start: number, end: number): string {
  let s = Math.max(0, Math.min(start, str.length));
  let e = Math.max(s, Math.min(end, str.length));
  while (s < e && str.charCodeAt(s) >= 0xdc00 && str.charCodeAt(s) <= 0xdfff) s += 1;
  while (e > s && str.charCodeAt(e - 1) >= 0xd800 && str.charCodeAt(e - 1) <= 0xdbff) e -= 1;
  return str.slice(s, e);
}

function headTail(content: string, keepChars: number): string {
  if (keepChars >= content.length) return content;
  const headLen = Math.floor(keepChars * 0.7);
  const tailLen = keepChars - headLen;
  const head = sliceCodePointSafe(content, 0, headLen);
  const tail = sliceCodePointSafe(content, content.length - tailLen, content.length);
  return `${head}\n\n[…中间内容已截断，保留头尾…]\n\n${tail}`;
}

export function buildContext(sources: ContextSource[], options: ContextBuildOptions): ContextBuildResult {
  const budget = Math.max(200, options.tokenBudget);
  const maxSingleShare = options.maxSingleShare ?? 0.6;
  const sorted = [...sources].sort((a, b) => b.priority - a.priority);

  const truncated: ContextBuildResult['truncated'] = [];
  const seen = new Map<string, string>(); // normalized content hash -> source id
  const blocks: string[] = [];
  let usedTokens = 0;

  for (const source of sorted) {
    const raw = (source.content || '').trim();
    if (!raw) continue;

    // 去重：相同内容只保留一份（高优先级先来）
    const key = `${raw.length}:${raw.slice(0, 120)}:${raw.slice(-120)}`;
    const duplicateOf = seen.get(key);
    if (duplicateOf) {
      truncated.push({ id: source.id, label: source.label, originalChars: raw.length, keptChars: 0, reason: 'duplicate' });
      continue;
    }
    seen.set(key, source.id);

    const remainingTokens = budget - usedTokens;
    if (remainingTokens <= 0) {
      truncated.push({ id: source.id, label: source.label, originalChars: raw.length, keptChars: 0, reason: 'budget' });
      continue;
    }

    const sourceTokens = approximateTokens(raw);
    const singleCapTokens = Math.max(120, Math.floor(budget * maxSingleShare));
    const allowedTokens = Math.min(remainingTokens, singleCapTokens);
    // 按该来源自身的“字符/token”比例折算允许保留的字符数（中英文自适应）
    const charsPerToken = raw.length / Math.max(1, sourceTokens);
    const allowedChars = Math.floor(allowedTokens * charsPerToken);

    if (sourceTokens <= allowedTokens) {
      blocks.push(`【${source.label}】\n${raw}`);
      usedTokens += sourceTokens;
    } else {
      const kept = headTail(raw, Math.max(200, allowedChars));
      blocks.push(`【${source.label}】\n${kept}`);
      const keptChars = Math.min(raw.length, Math.max(200, allowedChars));
      usedTokens += approximateTokens(kept);
      truncated.push({
        id: source.id,
        label: source.label,
        originalChars: raw.length,
        keptChars,
        reason: sourceTokens > singleCapTokens ? 'single-share' : 'budget',
      });
    }
  }

  const text = blocks.join('\n\n---\n\n');
  return {
    text,
    usedChars: text.length,
    estimatedTokens: approximateTokens(text),
    truncated,
  };
}
