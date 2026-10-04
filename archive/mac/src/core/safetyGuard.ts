// ============================================================
// Hank Agent Team · 五层安全机制
// 从 HankAI 审查系统 safetyGuard 同步，适配四部门架构
// ============================================================

// ============ 第一层：工具白名单（按部门） ============

type Department = 'command' | 'info' | 'develop' | 'review';

const DEPT_TOOL_WHITELIST: Record<Department, string[]> = {
  command: [],                          // 指挥部：无工具权限
  info: ['web_search', 'web_fetch'],   // 信息部：搜索与抓取
  develop: ['python_exec', 'read_file'], // 开发部：代码执行与文件读取
  review: ['read_file'],               // 审核部：只读文件
};

export function checkToolWhitelist(dept: Department, toolName: string): string | null {
  const allowed = DEPT_TOOL_WHITELIST[dept] || [];
  if (!allowed.includes(toolName)) {
    return `工具「${toolName}」不在部门「${dept}」的可用列表中（白名单：${allowed.length ? allowed.join(', ') : '无'}）`;
  }
  return null;
}

// ============ 第二层：速率限制 ============

const sessionCallCount = new Map<string, number>();
const deptRoundCount = new Map<string, number>();
const lastCallTime = new Map<string, number>();

const MAX_PER_ROUND = 5;
const MAX_PER_SESSION = 50;
const MIN_INTERVAL_MS = 1000;

export function checkRateLimit(sessionId: string, dept: Department, round: number): string | null {
  const now = Date.now();

  const total = sessionCallCount.get(sessionId) || 0;
  if (total >= MAX_PER_SESSION) {
    return `已达会话工具调用上限（${MAX_PER_SESSION} 次）`;
  }

  const roundKey = `${sessionId}:${dept}:${round}`;
  const roundCount = deptRoundCount.get(roundKey) || 0;
  if (roundCount >= MAX_PER_ROUND) {
    return `部门「${dept}」本轮已达调用上限（${MAX_PER_ROUND} 次）`;
  }

  const last = lastCallTime.get(sessionId);
  if (last && (now - last) < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (now - last);
    return `工具调用过于频繁，请等待 ${Math.ceil(waitMs / 1000)} 秒`;
  }

  return null;
}

export function recordToolCall(sessionId: string, dept: Department, round: number): void {
  const now = Date.now();
  sessionCallCount.set(sessionId, (sessionCallCount.get(sessionId) || 0) + 1);
  const roundKey = `${sessionId}:${dept}:${round}`;
  deptRoundCount.set(roundKey, (deptRoundCount.get(roundKey) || 0) + 1);
  lastCallTime.set(sessionId, now);
}

export function clearSession(sessionId: string): void {
  sessionCallCount.delete(sessionId);
  lastCallTime.delete(sessionId);
  for (const key of deptRoundCount.keys()) {
    if (key.startsWith(sessionId + ':')) deptRoundCount.delete(key);
  }
}

// ============ 第三层：参数校验 ============

const PRIVATE_IP_RE = /(^127\.)|(^10\.)|(^172\.1[6-9]\.)|(^172\.2\d\.)|(^172\.3[0-1]\.)|(^192\.168\.)|(^0\.)|(^169\.254\.)|(^::1$)|(^fc00:)|(^fe80:)/;

export function validateUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      return `URL 必须使用 HTTPS 协议，当前为: ${u.protocol}`;
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') {
      return '禁止访问 localhost 地址';
    }
    if (PRIVATE_IP_RE.test(u.hostname)) {
      return `禁止访问内网地址: ${u.hostname}`;
    }
    return null;
  } catch {
    return `无效的 URL 格式: ${url}`;
  }
}

const SENSITIVE_PATH_FRAGMENTS = [
  '/.ssh/', '/.git/', '/.svn/', '/.aws/', '/.kube/', '/.env',
  '/etc/passwd', '/etc/shadow', '/proc/', '/sys/', '/dev/',
];

let _workDir: string | null = null;
export function setWorkDir(dir: string) { _workDir = dir; }
export function getWorkDir(): string | null { return _workDir; }

export function validateFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const frag of SENSITIVE_PATH_FRAGMENTS) {
    if (normalized.includes(frag)) {
      return `禁止读取敏感路径（包含 ${frag}）`;
    }
  }
  if (_workDir && !normalized.startsWith(_workDir.replace(/\\/g, '/'))) {
    return `文件路径不在工作目录范围内（工作目录: ${_workDir}）`;
  }
  return null;
}

const PYTHON_FORBIDDEN = [
  /\bos\s*\./, /\bsubprocess\b/, /\beval\s*\(/, /\bexec\s*\(/,
  /\b__import__\s*\(/, /\bcompile\s*\(/, /\binput\s*\(/,
];

const PYTHON_MAX_LENGTH = 10000;
export const PYTHON_TIMEOUT_MS = 10000;

export function validatePythonCode(code: string): string | null {
  if (code.length > PYTHON_MAX_LENGTH) {
    return `代码过长（${code.length} 字符，上限 ${PYTHON_MAX_LENGTH}）`;
  }
  for (const pattern of PYTHON_FORBIDDEN) {
    if (pattern.test(code)) {
      const match = code.match(pattern);
      return `代码包含禁止的操作: ${match?.[0] || pattern.source}`;
    }
  }
  return null;
}

// ============ 第四层：沙箱执行（参数校验即沙箱主控） ============
// Python 执行通过子进程安全包装，详见 Engine.ts 中的 executePythonSandbox。

// ============ 第五层：结果清洗 ============

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /xox[bpras]-[A-Za-z0-9\-]+/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
];

const MAX_RESULT_LENGTH = 4000;

export function sanitizeResult(raw: string): string {
  let cleaned = raw;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[已过滤]');
  }
  if (cleaned.length > MAX_RESULT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_RESULT_LENGTH) + '\n\n[结果已截断，原始长度 ' + raw.length + ' 字符]';
  }
  return cleaned;
}

// ============ 综合安全入口 ============

export interface SafetyCheckResult {
  passed: boolean;
  error: string | null;
}

export function fullSafetyCheck(
  dept: Department,
  toolName: string,
  args: Record<string, string>,
  sessionId: string,
  round: number,
): SafetyCheckResult {
  const l1 = checkToolWhitelist(dept, toolName);
  if (l1) return { passed: false, error: `[L1-白名单] ${l1}` };

  const l2 = checkRateLimit(sessionId, dept, round);
  if (l2) return { passed: false, error: `[L2-速率限制] ${l2}` };

  if (toolName === 'web_fetch' && args.url) {
    const l3 = validateUrl(args.url);
    if (l3) return { passed: false, error: `[L3-参数校验] ${l3}` };
  }
  if (toolName === 'read_file' && args.path) {
    const l3 = validateFilePath(args.path);
    if (l3) return { passed: false, error: `[L3-参数校验] ${l3}` };
  }
  if (toolName === 'python_exec' && args.code) {
    const l3 = validatePythonCode(args.code);
    if (l3) return { passed: false, error: `[L3-参数校验] ${l3}` };
  }

  return { passed: true, error: null };
}
