// ============================================================
// verify（v3.2）：确定性校验器注册表
//
// 目标：verify 不再用"包含 {...} 就算 JSON"这类伪检查。
// 规则：
//   - nonempty：内容非空且长度达标；
//   - strict-json：整段内容必须严格 JSON.parse 成功，且是 object；
//     可配置 expectedKeys 做最小 schema 校验（缺 key 即失败）；
//   - live-source：live 任务中上游 draft 不能是 demo 来源；
//   - 未知检查项 → 直接判定失败（default-deny，不静默跳过）。
// 代码类任务未来接入编译/测试/lint 真实验证器（需受控沙箱，单独威胁模型）。
// ============================================================

export interface VerifyCheckResult {
  kind: string;
  ok: boolean;
  reason?: string;
}

export interface VerifyInput {
  checks: string[];
  content: string;
  /** live 任务中上游 draft 是否为 demo 来源 */
  liveSourceOk?: boolean;
  expectedKeys?: string[];
  minChars?: number;
}

export interface VerifyOutcome {
  ok: boolean;
  results: VerifyCheckResult[];
}

function checkStrictJson(content: string, expectedKeys: string[] | undefined): VerifyCheckResult {
  const trimmed = content.trim();
  if (!trimmed) return { kind: 'strict-json', ok: false, reason: '内容为空' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      kind: 'strict-json',
      ok: false,
      reason: `不是严格 JSON：${e instanceof Error ? e.message.slice(0, 120) : 'parse error'}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'strict-json', ok: false, reason: 'JSON 顶层必须是 object' };
  }
  if (expectedKeys && expectedKeys.length > 0) {
    const missing = expectedKeys.filter(k => !(k in (parsed as Record<string, unknown>)));
    if (missing.length > 0) {
      return { kind: 'strict-json', ok: false, reason: `缺少必需字段：${missing.join(', ')}` };
    }
  }
  return { kind: 'strict-json', ok: true };
}

export function evaluateVerify(input: VerifyInput): VerifyOutcome {
  const results: VerifyCheckResult[] = [];

  for (const check of input.checks) {
    switch (check) {
      case 'nonempty': {
        const min = input.minChars ?? 20;
        const ok = input.content.trim().length >= min;
        results.push({ kind: check, ok, reason: ok ? undefined : `内容过短（<${min} 字符）` });
        break;
      }
      case 'strict-json': {
        results.push(checkStrictJson(input.content, input.expectedKeys));
        break;
      }
      case 'live-source': {
        const ok = input.liveSourceOk !== false;
        results.push({ kind: check, ok, reason: ok ? undefined : '上游产出为演示/降级来源' });
        break;
      }
      default:
        // default-deny：未知校验项不得静默跳过
        results.push({ kind: check, ok: false, reason: `未知校验项：${check}` });
    }
  }

  return { ok: results.every(r => r.ok), results };
}
