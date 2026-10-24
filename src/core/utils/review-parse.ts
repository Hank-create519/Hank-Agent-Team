// 审核结论解析（单一事实源，Engine 与 v3 review service 共用）
// 优先解析 JSON 结论，解析不到时回退 default-deny 文本判定。
import { safeJsonParse } from '../llm';

export function parseReviewResult(content: string): { approved: boolean; issues: string[] } {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const { value, success } = safeJsonParse<{ result?: string; issues?: string[] }>(jsonMatch[0], {});
    if (success && value && (value.result === 'approved' || value.result === 'rejected')) {
      return {
        approved: value.result === 'approved',
        issues: Array.isArray(value.issues) ? value.issues.slice(0, 5).map(String) : [],
      };
    }
  }

  const hasReject = /打回|不通过|驳回|拒绝|❌/.test(content);
  const hasExplicitApprove = /(?:明确结论|审核结论|最终结论|判定)\s*[:：]?\s*(?:✅\s*)?(?:通过|approve\b)/i.test(content)
    || /^\s*(?:✅\s*)?(?:通过|approved)\s*$/im.test(content);
  if (hasReject || !hasExplicitApprove) {
    const issues = content.split('\n').filter(l => /问题|缺陷|漏洞|错误|建议|风险/.test(l)).slice(0, 5);
    return { approved: false, issues: issues.length ? issues : [hasReject ? '审核存在拒绝结论' : '审核没有给出明确通过结论'] };
  }
  return { approved: true, issues: [] };
}
