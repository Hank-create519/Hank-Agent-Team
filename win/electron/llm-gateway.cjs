// ============================================================
// LLM Gateway — 主进程统一模型网关（V2.2 步骤④）
// 渲染层只发 {agentId, provider, model, baseUrl, prompts}；
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

async function fetchWithRetry(url, init, retries = MAX_RETRIES) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        await sleep(BASE_DELAY_MS * Math.pow(2, i) + Math.random() * 500);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
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
  });
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
  });
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
  });
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
  const {
    agentId, provider = 'OpenAI', model, baseUrl, systemPrompt, userPrompt,
    dept = 'command', sessionId = 'sess', stage = '',
  } = payload || {};

  if (!agentId || !model) {
    return { content: '', error: '缺少 agentId 或 model', elapsedMs: 0, status: 'failed' };
  }

  const apiKey = secrets.getSecret(agentId);
  if (!apiKey) {
    audit.append({ type: 'llm-call', agentId, provider, model, stage, status: 'no-key' });
    return { content: '', error: `Agent「${agentId}」未配置 API Key（请在团队配置页设置）`, elapsedMs: 0, status: 'failed' };
  }

  const route = (DEFAULT_BASE_URL[provider] ? provider : 'OpenAI');
  const effectiveBaseUrl = baseUrl || DEFAULT_BASE_URL[route] || 'https://api.openai.com/v1';
  const isAnthropic = route === 'Anthropic';
  const isGoogle = route === 'Google';
  // 工具循环仅 OpenAI 兼容协议支持（Anthropic/Google 直出文本）
  const toolsAllowed = !isAnthropic && !isGoogle;

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
        signal: undefined,
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
        type: 'llm-call', agentId, provider: route, model, stage,
        status: content ? 'ok' : 'empty', elapsedMs,
        toolsUsed: usedTools.length ? usedTools : undefined,
      });
      if (!content) {
        return { content: '', error: '模型返回空响应', elapsedMs, status: 'failed' };
      }
      return { content, elapsedMs, status: 'live', toolCalls: usedTools.length ? usedTools : undefined };
    }

    return { content: '[工具循环耗尽]', error: '工具调用轮次已达上限', elapsedMs: Date.now() - started, status: 'failed' };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    audit.append({ type: 'llm-call', agentId, provider: route, model, stage, status: 'failed', error: msg.slice(0, 200) });
    return { content: '', error: msg, elapsedMs: Date.now() - started, status: 'failed' };
  }
}

/** 连接测试：极小请求验证 Key + 模型 + 端点 */
async function testConnection({ agentId, provider, model, baseUrl }) {
  const started = Date.now();
  const r = await callLLM({
    agentId, provider, model, baseUrl,
    systemPrompt: 'You are a connection tester. Reply with: ok',
    userPrompt: 'ping', dept: 'command', sessionId: 'conn-test', stage: 'connection-test',
  });
  return { ok: r.status === 'live', error: r.error, elapsedMs: r.elapsedMs };
}

module.exports = { callLLM, testConnection };
