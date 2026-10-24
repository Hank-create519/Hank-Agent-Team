// ============================================================
// Tool Runtime — 工具注册表 / 策略 / 执行器（V2.2 步骤⑤⑥）
// 原则：Agent ≠ Tool。能力挂在注册表上，按部门策略授权。
// V2.2 只启用 web_search 一个真实工具；其余注册但 disabled（V2.5 接入）。
// 所有执行经由：策略检查 → 限流 → 参数校验 → 执行 → 结果清洗 → 审计。
// ============================================================

const audit = require('./audit.cjs');

// ── 部门 → 工具授权（与安全层理念一致：指挥部无工具，审核部可查证据）──
const DEPT_TOOL_POLICY = {
  command: [],
  info: ['web_search'],
  develop: [],           // V2.5: read_file / python_exec
  review: ['web_search'], // 审查部的证据检索（Claim → Evidence）
};

// ── 限流 ──
const MAX_PER_SESSION = 20;
const MIN_INTERVAL_MS = 800;
const _sessionCount = new Map();
const _lastCall = new Map();
// 会话生命周期治理（v3.2）：TTL + 上限淘汰，避免长期运行残留
const _sessionSeen = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 200;

function sweepSessions() {
  const now = Date.now();
  for (const [sid, seenAt] of _sessionSeen) {
    if (now - seenAt > SESSION_TTL_MS) {
      _sessionCount.delete(sid);
      _lastCall.delete(sid);
      _sessionSeen.delete(sid);
    }
  }
  if (_sessionSeen.size > MAX_SESSIONS) {
    const oldest = [..._sessionSeen.entries()].sort((a, b) => a[1] - b[1]);
    for (const [sid] of oldest.slice(0, _sessionSeen.size - MAX_SESSIONS)) {
      _sessionCount.delete(sid);
      _lastCall.delete(sid);
      _sessionSeen.delete(sid);
    }
  }
}

// ── 结果清洗（沿用安全层思路）──
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/g, /sk-[A-Za-z0-9]{32,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, /xox[bpras]-[A-Za-z0-9\-]+/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
];
const MAX_RESULT_LENGTH = 4000;

function sanitizeResult(raw) {
  let cleaned = raw;
  for (const p of SECRET_PATTERNS) cleaned = cleaned.replace(p, '[已过滤]');
  if (cleaned.length > MAX_RESULT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_RESULT_LENGTH) + '\n[结果已截断]';
  }
  return cleaned;
}

// ── 工具注册表 ──
const REGISTRY = {
  web_search: {
    name: 'web_search',
    description: '搜索互联网获取实时信息',
    enabled: true,
    argSpec: { query: { type: 'string', required: true, maxLen: 300 } },
    execute: executeWebSearch,
  },
  web_fetch: {
    name: 'web_fetch', description: '抓取指定 URL 网页', enabled: false, argSpec: {},
    execute: async () => '[未启用] web_fetch 将在 V2.5 接入',
  },
  read_file: {
    name: 'read_file', description: '读取本地文件', enabled: false, argSpec: {},
    execute: async () => '[未启用] read_file 将在 V2.5 接入',
  },
  python_exec: {
    name: 'python_exec', description: '执行 Python 代码', enabled: false, argSpec: {},
    execute: async () => '[未启用] python_exec 将在 V2.5 接入',
  },
};

function checkPolicy(dept, toolName) {
  const allowed = DEPT_TOOL_POLICY[dept] || [];
  const def = REGISTRY[toolName];
  if (!def) return `未知工具「${toolName}」`;
  if (!def.enabled) return `工具「${toolName}」尚未启用（V2.5 接入）`;
  if (!allowed.includes(toolName)) {
    return `部门「${dept}」无权使用「${toolName}」（授权：${allowed.length ? allowed.join(', ') : '无'}）`;
  }
  return null;
}

function validateArgs(def, args) {
  if (!args || typeof args !== 'object') return '参数必须为对象';
  for (const [name, spec] of Object.entries(def.argSpec)) {
    const v = args[name];
    if (spec.required && (!v || typeof v !== 'string')) return `缺少必填参数「${name}」`;
    if (v && typeof v === 'string' && v.length > spec.maxLen) return `参数「${name}」超出长度限制（${spec.maxLen}）`;
  }
  return null;
}

function checkRateLimit(sessionId) {
  const count = _sessionCount.get(sessionId) || 0;
  if (count >= MAX_PER_SESSION) return `会话工具调用已达上限（${MAX_PER_SESSION} 次）`;
  const last = _lastCall.get(sessionId);
  if (last && Date.now() - last < MIN_INTERVAL_MS) return '工具调用过于频繁，请稍候';
  return null;
}

function recordCall(sessionId) {
  _sessionCount.set(sessionId, (_sessionCount.get(sessionId) || 0) + 1);
  _lastCall.set(sessionId, Date.now());
  _sessionSeen.set(sessionId, Date.now());
}

// ── web_search 真实执行器 ──
// 首选 DuckDuckGo Lite（免 Key）；结果为 {title,url,snippet} 列表。
// 局限如实说明：社区 HTML 接口，可能随页面改版失效；Tavily 等接入留待 V2.5。
async function executeWebSearch(args) {
  const query = String(args.query || '').trim();
  if (!query) return '[错误] 缺少 query';

  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HankAgentTeam/2.2',
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return `[搜索失败] HTTP ${res.status}`;
  const html = await res.text();

  // 解析 DDG Lite 结果块：<a rel="nofollow" class="result__a" href="...">标题</a> + result__snippet
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [];
  let sm;
  while ((sm = snipRe.exec(html)) !== null) {
    snippets.push(sm[1].replace(/<[^>]+>/g, '').trim());
  }
  let m;
  while ((m = re.exec(html)) !== null && results.length < 5) {
    let url = m[1];
    const dec = url.match(/uddg=([^&]+)/); // DDG 跳转包装
    if (dec) url = decodeURIComponent(dec[1]);
    results.push({
      title: m[2].replace(/<[^>]+>/g, '').trim(),
      url,
      snippet: snippets[results.length] || '',
    });
  }
  if (results.length === 0) return `[搜索无结果] query: ${query}`;
  return results
    .map((r, i) => `#${i + 1} ${r.title}\n来源: ${r.url}\n${r.snippet}`)
    .join('\n\n');
}

// ── 统一入口 ──
async function executeTool({ dept, sessionId, toolName, args }) {
  sweepSessions();
  const started = Date.now();
  const policyErr = checkPolicy(dept, toolName);
  if (policyErr) {
    audit.append({ type: 'tool-denied', dept, tool: toolName, reason: policyErr });
    return { ok: false, content: `[安全拦截] ${policyErr}` };
  }
  const def = REGISTRY[toolName];
  const argErr = validateArgs(def, args);
  if (argErr) {
    audit.append({ type: 'tool-denied', dept, tool: toolName, reason: argErr });
    return { ok: false, content: `[参数校验] ${argErr}` };
  }
  const rateErr = checkRateLimit(sessionId);
  if (rateErr) {
    audit.append({ type: 'tool-denied', dept, tool: toolName, reason: rateErr });
    return { ok: false, content: `[限流] ${rateErr}` };
  }
  recordCall(sessionId);

  try {
    const raw = await def.execute(args || {});
    const content = sanitizeResult(raw);
    audit.append({
      type: 'tool-call', dept, tool: toolName,
      argsSummary: JSON.stringify(args).slice(0, 200),
      ok: true, elapsedMs: Date.now() - started,
    });
    return { ok: true, content };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    audit.append({ type: 'tool-error', dept, tool: toolName, error: msg.slice(0, 200), elapsedMs: Date.now() - started });
    return { ok: false, content: `[执行错误] ${msg}` };
  }
}

function resetSession(sessionId) {
  _sessionCount.delete(sessionId);
  _lastCall.delete(sessionId);
  _sessionSeen.delete(sessionId);
}

module.exports = { executeTool, checkPolicy, sanitizeResult, resetSession, DEPT_TOOL_POLICY, REGISTRY };
