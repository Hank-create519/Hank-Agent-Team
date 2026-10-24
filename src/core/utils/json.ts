// JSON 容错解析（单一实现；legacy llm.ts 仅做 re-export 兼容）
// ============ JSON 容错解析 ============
/**
 * 安全 JSON 解析 — 剥离 Markdown 代码块包裹、修复尾部逗号
 * 失败时不抛异常，返回 fallback 并 console.warn
 */
export function safeJsonParse<T>(raw: string, fallback: T): { value: T; success: boolean } {
  let cleaned = raw.trim();
  const codeBlock = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) cleaned = codeBlock[1].trim();

  try {
    return { value: JSON.parse(cleaned) as T, success: true };
  } catch { /* 进入修复流程 */ }

  const noTrailingComma = cleaned.replace(/,(\s*[}\]])/g, '$1');
  try {
    return { value: JSON.parse(noTrailingComma) as T, success: true };
  } catch { /* 进入修复流程 */ }

  const relaxed = noTrailingComma
    .replace(/(?<!https?:)\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  try {
    return { value: JSON.parse(relaxed) as T, success: true };
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[safeJsonParse] 解析失败, 原始片段:', cleaned.slice(0, 200));
    return { value: fallback, success: false };
  }
}
