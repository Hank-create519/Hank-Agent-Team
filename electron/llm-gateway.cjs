// ============================================================
// LLM Gateway — 主进程统一模型网关（v3.1）
// 渲染层只发 {agentId, provider, model, prompts}；**不接受 baseUrl**（端点由主进程解析）。
// 密钥解析、协议路由、重试、超时、工具循环、审计全部在此完成。
// 工具循环（仅 OpenAI 兼容协议）：最多 4 轮，工具结果来自 Tool Runtime（真实执行）。
// 审计日志永不包含密钥与完整 prompt。
// ============================================================

const secrets = require('./secrets.cjs');
const audit = require('./audit.cjs');
const toolRuntime = require('./tool-runtime.cjs');

const TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_TOOL_ITERATIONS = 4;

const DEFAULT_BASE_URL = {
  'OpenAI': 'https://api.openai.com/v1',
  'Anthropic': 'https://api.anthropic.com/v1',
  'Google': 'https://generativelanguage.googleapis.com',
  'DeepSeek': 'https://api.deepseek.com/v1',
  '阿里千问': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  '智谱': 'https://open.bigmodel.cn/api/paas/v4',
  '百度文心': 'https://qianfan.baidubce.com/v2',
  '月之暗面': 'https://api.moonshot.cn/v1',
  'MiniMax': 'https://api.minimax.chat/v1',
  '零一万物': 'https://api.lingyiwanwu.com/v1',
  'Mistral': 'https://api.mistral.ai/v1',
  '讯飞星火': 'https://spark-api-open.xf-yun.com/v1',
  '字节豆包': 'https://ark.cn-beijing.volces.com/api/v3',
  '百川智能': 'https://api.baichuan-ai.com/v1',
};

// 未配置默认端点的厂商：明确失败，绝不静默回退到 OpenAI（避免把 Key 发到错误地址）
const UNSUPPORTED_PROVIDERS = new Set(['腾讯混元', 'Meta']);

/**
 * 解析厂商默认端点（主进程唯一事实源）。
 * 规则：
 *   - 渲染层传入的 baseUrl 一律拒绝（见 callLLM）；
 *   - 未配置默认端点的厂商明确抛错；
 *   - 未知 provider 明确抛错，不允许静默落到 OpenAI。
 */
function resolveEndpoint(provider) {
  const name = String(provider || 'OpenAI');
  if (UNSUPPORTED_PROVIDERS.has(name)) {
    throw new Error(`Provider「${name}」暂无默认端点：请改用受支持的厂商，或在主进程配置端点后启用`);
  }
  const base = DEFAULT_BASE_URL[name];
  if (!base) {
    throw new Error(`未知 Provider「${name}」：不允许静默回退到 OpenAI，请使用受支持的厂商`);
  }
  return base;
}

// ── IPC payload 校验（v3.2）：主进程边界必须验证类型/长度/枚举 ──
const KNOWN_PROVIDERS = new Set([...Object.keys(DEFAULT_BASE_URL), ...UNSUPPORTED_PROVIDERS]);
const ALLOWED_DEPTS = new Set(['command', 'info', 'develop', 'review']);
const ALLOWED_STAGES = new Set([
  'plan', 'extract', 'research', 'draft', 'review', 'verify', 'deliver', 'difficulty', 'legacy',
  'difficulty_assess', 'init', 'audit_entry', 'content_review', 'code_review', 'deep_audit', 'deploy', 'done',
]);
const PAYLOAD_LIMITS = {
  agentId: 128, provider: 64, model: 128, stage: 64,
  systemPrompt: 20000, userPrompt: 100000,
  sessionId: 128, taskId: 128, nodeId: 128, requestId: 128,
};

function isNonEmptyString(v, maxLen) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}

/**
 * 校验 ipcMain 传入的 LLM 调用 payload。
 * 拒绝：超长 Prompt、未知 provider、非法部门、异常 session/task/node id、非法 attempt。
 * 返回 {ok, errors}；错误由调用方转为 failed + 审计（不抛异常给 renderer）。
 */
function validatePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['payload 必须是对象'] };
  }
  if (!isNonEmptyString(payload.agentId, PAYLOAD_LIMITS.agentId)) errors.push('agentId 非法（空/超长/非字符串）');
  if (!isNonEmptyString(payload.provider, PAYLOAD_LIMITS.provider)) {
    errors.push('provider 非法（空/超长/非字符串）');
  } else if (!KNOWN_PROVIDERS.has(String(payload.provider))) {
    errors.push(`provider 未知：${String(payload.provider)}（不允许静默回退）`);
  }
  if (!isNonEmptyString(payload.model, PAYLOAD_LIMITS.model)) errors.push('model 非法（空/超长/非字符串）');
  if (payload.dept !== undefined && !ALLOWED_DEPTS.has(String(payload.dept))) errors.push(`dept 非法：${String(payload.dept)}`);
  if (payload.stage !== undefined && !ALLOWED_STAGES.has(String(payload.stage))) errors.push(`stage 非法：${String(payload.stage)}`);
  if (!isNonEmptyString(payload.userPrompt, PAYLOAD_LIMITS.userPrompt)) errors.push('userPrompt 非法（空/超长/非字符串）');
  if (payload.systemPrompt !== undefined && !isNonEmptyString(payload.systemPrompt, PAYLOAD_LIMITS.systemPrompt)) {
    errors.push('systemPrompt 非法（空/超长/非字符串）');
  }
  for (const key of ['sessionId', 'taskId', 'nodeId', 'requestId']) {
    if (payload[key] !== undefined && !isNonEmptyString(payload[key], PAYLOAD_LIMITS[key])) {
      errors.push(`${key} 非法（空/超长/非字符串）`);
    }
  }
  if (payload.attempt !== undefined) {
    const a = Number(payload.attempt);
    if (!Number.isInteger(a) || a < 0 || a > 100) errors.push('attempt 非法（必须为 0—100 的整数）');
  }
  return { ok: errors.length === 0, errors };
}

// ── 取消支持（v3.2）：主进程登记在途请求，按 taskId 取消 ──
const _activeRequests = new Map(); // requestId -> { controller, taskId, startedAt }

function cancelTask(taskId) {
  let cancelled = 0;
  for (const [requestId, entry] of _activeRequests) {
    if (!taskId || entry.taskId === taskId) {
      entry.controller.abort();
      _activeRequests.delete(requestId);
      cancelled += 1;
    }
  }
  return { cancelled };
}

let _auditSeq = 0;
function nextAuditId() {
  _auditSeq += 1;
  return `aud_${Date.now().toString(36)}_${_auditSeq}`;
}

// OpenAI 兼容协议的工具定义（主流程真实可用）
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取实时信息。当问题涉及最新事实、市场数据、产品信息时使用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词' } },
        required: ['query'],
      },
    },
  },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(url, init, retries = MAX_RETRIES, externalSignal) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const signal = externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
    try {
      const res = await fetch(url, { ...init, signal });
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        await sleep(BASE_DELAY_MS * Math.pow(2, i) + Math.random() * 500);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (externalSignal && externalSignal.aborted) {
        const cancelled = new Error('请求已取消（任务被停止）');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
      if (i < retries) { await sleep(BASE_DELAY_MS * Math.pow(2, i)); continue; }
    }
  }
  throw lastErr || new Error('请求失败');
}

async function callOpenAICompat({ baseUrl, apiKey, model, messages, withTools, signal }) {
  const body = { model, messages, temperature: 0.4, max_tokens: 4096 };
  if (withTools) body.tools = AGENT_TOOLS;
  const res = await fetchWithRetry(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  }, MAX_RETRIES, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const choice = json.choices && json.choices[0];
  if (!choice) return { content: '', toolCalls: null };
  if (choice.finish_reason === 'tool_calls' && choice.message && choice.message.tool_calls) {
    return { content: '', toolCalls: choice.message.tool_calls };
  }
  return { content: choice.message ? (choice.message.content || '') : '', toolCalls: null };
}

async function callAnthropic({ baseUrl, apiKey, model, system, messages, signal }) {
  const res = await fetchWithRetry(baseUrl.replace(/\/+$/, '') + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, system: system || undefined, messages, max_tokens: 4096, temperature: 0.4 }),
    signal,
  }, MAX_RETRIES, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return { content: (json.content && json.content[0] && json.content[0].text) || '', toolCalls: null };
}

async function callGoogle({ baseUrl, apiKey, model, system, messages, signal }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }],
  }));
  const res = await fetchWithRetry(baseUrl.replace(/\/+$/, '') + `/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    }),
    signal,
  }, MAX_RETRIES, signal);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return {
    content: (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text) || '',
    toolCalls: null,
  };
}

/**
 * 统一入口：renderer → IPC llm-call → 此函数。
 * payload: {agentId, provider, model, baseUrl, systemPrompt, userPrompt, dept, sessionId, stage}
 * 返回: {content, error?, elapsedMs, status: 'live'|'failed', toolCalls?: [{name, ok}]}
 */
async function callLLM(payload) {
  const started = Date.now();
  const auditId = nextAuditId();
  const rejectBaseUrl = payload && Object.prototype.hasOwnProperty.call(payload, 'baseUrl') && payload.baseUrl != null;
  if (rejectBaseUrl) {
    audit.append({
      type: 'llm-call-rejected', auditId, reason: 'renderer-supplied-baseUrl',
      agentId: String((payload && payload.agentId) || ''),
    });
    return {
      content: '', error: '安全拒绝：渲染进程不允许指定 baseUrl（模型端点由主进程统一管理）',
      errorCode: 'no-key', elapsedMs: 0, status: 'failed', auditId,
    };
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    audit.append({ type: 'llm-call-rejected', auditId, reason: 'payload-invalid', errors: validation.errors });
    return {
      content: '', error: `参数校验失败：${validation.errors.join('；')}`,
      errorCode: 'unknown', elapsedMs: 0, status: 'failed', auditId,
    };
  }

  const {
    agentId, provider, model, systemPrompt, userPrompt,
    dept = 'command', sessionId = 'sess', stage = '',
    taskId = '', nodeId = '', attempt = 0, requestId = auditId,
  } = payload;

  const apiKey = secrets.getSecret(agentId);
  if (!apiKey) {
    audit.append({ type: 'llm-call', auditId, agentId, provider, model, stage, taskId, nodeId, attempt, status: 'no-key' });
    return {
      content: '', error: `Agent「${agentId}」未配置 API Key（请在团队配置页设置）`,
      errorCode: 'no-key', elapsedMs: 0, status: 'failed', auditId,
    };
  }

  let effectiveBaseUrl;
  try {
    effectiveBaseUrl = resolveEndpoint(provider);
  } catch (e) {
    audit.append({ type: 'llm-call', auditId, agentId, provider, model, stage, taskId, nodeId, attempt, status: 'bad-provider' });
    return { content: '', error: e.message, errorCode: 'http-error', elapsedMs: 0, status: 'failed', auditId };
  }
  const route = provider;
  const isAnthropic = route === 'Anthropic';
  const isGoogle = route === 'Google';
  // 工具循环仅 OpenAI 兼容协议支持（Anthropic/Google 直出文本）
  const toolsAllowed = !isAnthropic && !isGoogle;

  const controller = new AbortController();
  _activeRequests.set(requestId, { controller, taskId, startedAt: started });

  try {
    let messages = [
      { role: 'system', content: `[系统] 当前日期：${new Date().toISOString().slice(0, 10)}。\n\n${systemPrompt || '你是 Hank Agent Team 的一员，请按要求完成任务。'}` },
      { role: 'user', content: userPrompt },
    ];
    const usedTools = [];

    for (let iter = 0; iter < (toolsAllowed ? MAX_TOOL_ITERATIONS : 1); iter++) {
      const params = {
        baseUrl: effectiveBaseUrl, apiKey, model, system: messages[0].content,
        messages: messages.filter((m) => m.role !== 'system'),
        signal: controller.signal,
      };
      let result;
      if (isAnthropic) {
        result = await callAnthropic({ ...params, messages: params.messages.map((m) => ({ role: m.role, content: m.content })) });
      } else if (isGoogle) {
        result = await callGoogle(params);
      } else {
        result = await callOpenAICompat({ ...params, withTools: toolsAllowed });
      }

      // 模型请求工具 → 经 Tool Runtime 真实执行 → 结果回注
      if (result.toolCalls && result.toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: result.content || '', tool_calls: result.toolCalls });
        for (const tc of result.toolCalls) {
          const name = tc.function && tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
          const out = await toolRuntime.executeTool({ dept, sessionId, toolName: name, args });
          usedTools.push({ name, ok: out.ok });
          messages.push({ role: 'tool', tool_call_id: tc.id || `call_${iter}_${usedTools.length}`, content: out.content });
        }
        continue;
      }

      const content = result.content;
      const elapsedMs = Date.now() - started;
      audit.append({
        type: 'llm-call', auditId, agentId, provider: route, model, stage,
        taskId, nodeId, attempt,
        status: content ? 'ok' : 'empty', elapsedMs,
        toolsUsed: usedTools.length ? usedTools : undefined,
      });
      if (!content) {
        return { content: '', error: '模型返回空响应', errorCode: 'empty-response', elapsedMs, status: 'failed', auditId };
      }
      return { content, elapsedMs, status: 'live', auditId, toolCalls: usedTools.length ? usedTools : undefined };
    }

    return { content: '', error: '工具调用轮次已达上限', errorCode: 'empty-response', elapsedMs: Date.now() - started, status: 'failed', auditId };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const cancelled = e && e.name === 'AbortError' && controller.signal.aborted;
    const errorCode = cancelled ? 'aborted' : /timeout|超时/i.test(msg) ? 'http-error' : 'http-error';
    audit.append({
      type: 'llm-call', auditId, agentId, provider: route, model, stage, taskId, nodeId, attempt,
      status: cancelled ? 'cancelled' : 'failed', error: msg.slice(0, 200),
    });
    return { content: '', error: msg, errorCode, elapsedMs: Date.now() - started, status: 'failed', auditId };
  } finally {
    _activeRequests.delete(requestId);
  }
}

/** 连接测试：极小请求验证 Key + 模型 + 端点 */
async function testConnection({ agentId, provider, model }) {
  const started = Date.now();
  const r = await callLLM({
    agentId, provider, model,
    systemPrompt: 'You are a connection tester. Reply with: ok',
    userPrompt: 'ping', dept: 'command', sessionId: 'conn-test', stage: 'connection-test',
  });
  return { ok: r.status === 'live', error: r.error, elapsedMs: r.elapsedMs };
}

module.exports = {
  callLLM,
  testConnection,
  // 供主进程契约测试使用（纯函数，不触网）
  resolveEndpoint,
  DEFAULT_BASE_URL,
  UNSUPPORTED_PROVIDERS,
  validatePayload,
  cancelTask,
  nextAuditId,
};
