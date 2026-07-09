// ============================================================
// 统一 LLM 客户端 —— 真实 + 模拟双模 + Function Calling 工具循环
// - 有 API Key：按 provider 走真实协议（OpenAI 兼容 / Anthropic / Google）
// - 支持 Function Calling 工具循环（参考 HankAI 审查系统 engine.ts）
// - 无 API Key：fallback 到 mockResponses，保证流水线可完整验收
// ============================================================

import { Agent, ModelConfig, PipelineStage, Department } from './types';
import { mockResponse } from './mockResponses';
import { fullSafetyCheck, recordToolCall, clearSession, sanitizeResult } from './safetyGuard';

export interface LLMResult {
  content: string;
  error?: string;
  elapsedMs: number;
  mock: boolean;      // 是否走了 mock
  retryCount: number; // 实际重试次数（0 表示首次成功或未重试）
}

type Provider = 'openai' | 'anthropic' | 'google';

// 厂商 → 协议路由（其余国产模型均走 OpenAI 兼容协议）
function routeProvider(model: ModelConfig | undefined): Provider {
  if (!model) return 'openai';
  const p = model.provider;
  if (p === 'Anthropic') return 'anthropic';
  if (p === 'Google') return 'google';
  return 'openai';
}

// 厂商默认兼容端点（用户未填 baseUrl 时兜底）
const DEFAULT_BASE_URL: Record<string, string> = {
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
};

function resolveBaseUrl(agent: Agent, model: ModelConfig | undefined): string {
  if (agent.baseUrl) return agent.baseUrl.replace(/\/+$/, '');
  if (model) return (DEFAULT_BASE_URL[model.provider] || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return 'https://api.openai.com/v1';
}

// 模型名转实际调用名（model id 即调用名，部分需替换）
function resolveModelName(agent: Agent): string {
  return agent.model;
}

const TIMEOUT_MS = 60000;

function fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ============ 重试退避包装 ============
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function fetchWithRetry(
  fn: () => Promise<Response>,
  retries = MAX_RETRIES,
): Promise<{ response: Response; retryCount: number }> {
  let retryCount = 0;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fn();
      if ((res.status === 429 || res.status >= 500) && i < retries) {
        retryCount++;
        const delay = BASE_DELAY_MS * Math.pow(2, i) + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return { response: res, retryCount };
    } catch (e) {
      if (i === retries) throw e;
      retryCount++;
      const delay = BASE_DELAY_MS * Math.pow(2, i) + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('fetchWithRetry 耗尽');
}

// ============ OpenAI 兼容协议 ============
async function callOpenAICompat(
  baseUrl: string, apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
): Promise<{ content: string; retryCount: number }> {
  const url = `${baseUrl}/chat/completions`;
  const { response: res, retryCount } = await fetchWithRetry(() => fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    }),
  }, TIMEOUT_MS));

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return { content: json.choices?.[0]?.message?.content || '', retryCount };
}

// ============ Anthropic 协议 ============
async function callAnthropic(
  baseUrl: string, apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
): Promise<{ content: string; retryCount: number }> {
  const url = `${baseUrl}/messages`;
  const { response: res, retryCount } = await fetchWithRetry(() => fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 4096,
      temperature: 0.4,
    }),
  }, TIMEOUT_MS));

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return { content: json.content?.[0]?.text || '', retryCount };
}

// ============ Google 协议 ============
async function callGoogle(
  baseUrl: string, apiKey: string, model: string,
  systemPrompt: string, userPrompt: string,
): Promise<{ content: string; retryCount: number }> {
  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const { response: res, retryCount } = await fetchWithRetry(() => fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    }),
  }, TIMEOUT_MS));

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || '', retryCount };
}

// ============ Function Calling 工具循环 ============

/** 工具定义（OpenAI function calling 格式） */
export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: '搜索互联网获取实时信息',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_fetch',
      description: '抓取指定 URL 的网页内容',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标网页 URL' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取本地文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'python_exec',
      description: '在安全沙箱中执行 Python 代码',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python 代码' },
        },
        required: ['code'],
      },
    },
  },
];

interface ToolMessage {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

const MAX_ITERATIONS = 15;
const WARN_AT = 10;

/**
 * 带 Function Calling 的 LLM 调用。
 * 当模型返回 tool_calls 时执行工具并将结果注入消息循环，
 * 最多迭代 MAX_ITERATIONS 轮，超限强制模型输出文本。
 */
export async function callAIWithTools(
  agent: Agent,
  models: ModelConfig[],
  stage: PipelineStage,
  systemPrompt: string,
  userPrompt: string,
  sessionId: string,
  round: number,
  signal?: AbortSignal,
): Promise<LLMResult> {
  const start = Date.now();
  const model = models.find(m => m.id === agent.model);

  // 无 Key → mock 模式
  if (!agent.apiKey) {
    await delay(800 + Math.random() * 600);
    return {
      content: mockResponse(stage, userPrompt),
      elapsedMs: Date.now() - start,
      mock: true,
      retryCount: 0,
    };
  }

  const provider = routeProvider(model);
  const baseUrl = resolveBaseUrl(agent, model);
  const controller = new AbortController();
  if (signal) signal.addEventListener('abort', () => controller.abort());

  const today = new Date().toISOString().slice(0, 10);
  const dept = agent.department as Department;

  const localMessages: ToolMessage[] = [
    { role: 'system', content: `[系统] 当前日期：${today}。\n\n${systemPrompt}\n\n[系统提示] 你最多可调用 ${MAX_ITERATIONS} 轮工具。请在获得足够信息后尽早给出最终文本回复。` },
    { role: 'user', content: userPrompt },
  ];

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // 最后一轮：强制终止工具调用
      if (iter === MAX_ITERATIONS - 1) {
        const lastMsg = localMessages[localMessages.length - 1];
        if (lastMsg?.role === 'assistant' && (lastMsg as any).tool_calls?.length > 0) {
          localMessages.push({
            role: 'user',
            content: '工具调用轮次已达上限。请立即基于上述所有历史信息直接输出最终文字结论。不要再请求调用任何工具。',
          });
          const finalContent = await rawChatCompletion(
            provider, baseUrl, agent.apiKey, agent.model, localMessages, controller.signal,
          );
          return { content: finalContent || '[工具循环耗尽]', elapsedMs: Date.now() - start, mock: false, retryCount: 0 };
        }
      }

      const rawContent = await rawChatCompletion(
        provider, baseUrl, agent.apiKey, agent.model, localMessages, controller.signal, true,
      );

      // 解析响应：可能是文本或 tool_calls
      // rawChatCompletion 返回 JSON 字符串时需要解析
      if (!rawContent) {
        return { content: '[空响应]', elapsedMs: Date.now() - start, mock: false, retryCount: 0 };
      }

      // 尝试解析为 tool_calls JSON
      let hasToolCalls = false;
      const { value: parsed, success } = safeJsonParse<{ tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }>(rawContent, {});
      if (success && parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
          hasToolCalls = true;
          localMessages.push({
            role: 'assistant',
            content: '',
            tool_calls: parsed.tool_calls,
          });

          for (const tc of parsed.tool_calls) {
            const toolName = tc.function?.name || '';
            let args: Record<string, string> = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }

            // 五层安全校验
            const safety = fullSafetyCheck(dept, toolName, args, sessionId, round);
            let toolContent: string;
            if (!safety.passed) {
              toolContent = `[安全拦截] ${safety.error}`;
            } else {
              recordToolCall(sessionId, dept, round);
              toolContent = `[工具 ${toolName} 模拟执行结果]\n参数: ${JSON.stringify(args)}\n状态: 完成`;
            }

            if (iter >= WARN_AT) {
              const remaining = MAX_ITERATIONS - iter - 1;
              toolContent += `\n\n[系统提示] 工具调用轮次即将耗尽，剩余 ${remaining} 轮。请准备给出最终结论。`;
            }

            localMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: sanitizeResult(toolContent),
            });
          }
          continue;
        }


      if (!hasToolCalls) {
        return { content: rawContent, elapsedMs: Date.now() - start, mock: false, retryCount: 0 };
      }
    }

    return { content: '[工具循环耗尽]', elapsedMs: Date.now() - start, mock: false, retryCount: 0 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: mockResponse(stage, userPrompt),
      error: `工具循环失败已降级 mock：${msg}`,
      elapsedMs: Date.now() - start,
      mock: true,
      retryCount: 0,
    };
  }
}

/**
 * 原始聊天补全请求（返回 content 字符串或 tool_calls JSON）
 */
async function rawChatCompletion(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ToolMessage[],
  signal: AbortSignal,
  withTools = false,
): Promise<string> {
  if (provider === 'anthropic') {
    // Anthropic 暂不支持 tool loop，降级为普通调用
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content || '' }));
    return callAnthropicRaw(baseUrl, apiKey, model, systemMsg, chatMsgs, signal);
  }
  if (provider === 'google') {
    return callGoogleRaw(baseUrl, apiKey, model, messages, signal);
  }
  return callOpenAICompatWithTools(baseUrl, apiKey, model, messages, signal, withTools);
}

async function callOpenAICompatWithTools(
  baseUrl: string, apiKey: string, model: string,
  messages: ToolMessage[], signal: AbortSignal, withTools: boolean,
): Promise<string> {
  const url = `${baseUrl}/chat/completions`;
  const body: any = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 4096,
  };
  if (withTools) body.tools = AGENT_TOOLS;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, 60000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) return '';

  // 有 tool_calls 时返回 JSON 标记
  if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length > 0) {
    return JSON.stringify({ tool_calls: choice.message.tool_calls });
  }

  return choice.message?.content || '';
}

async function callAnthropicRaw(
  baseUrl: string, apiKey: string, model: string,
  systemPrompt: string, chatMsgs: { role: string; content: string }[], signal: AbortSignal,
): Promise<string> {
  const url = `${baseUrl}/messages`;
  const body: any = {
    model,
    messages: chatMsgs,
    max_tokens: 4096,
    temperature: 0.4,
  };
  if (systemPrompt) body.system = [{ type: 'text', text: systemPrompt }];

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  }, 60000);

  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

async function callGoogleRaw(
  baseUrl: string, apiKey: string, model: string,
  messages: ToolMessage[], signal: AbortSignal,
): Promise<string> {
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }],
  }));

  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body: any = {
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  };
  if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 60000);

  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
/**
 * 调用 LLM。有 Key 走真实协议，无 Key 走 mock。
 * 不抛异常 —— 错误返回在 error 字段，调用方自行处理。
 */
export async function callLLM(
  agent: Agent,
  models: ModelConfig[],
  stage: PipelineStage,
  userPrompt: string,
): Promise<LLMResult> {
  const start = Date.now();
  const model = models.find(m => m.id === agent.model);

  // 无 Key → mock 模式（模拟网络延迟）
  if (!agent.apiKey) {
    await delay(600 + Math.random() * 700);
    return {
      content: mockResponse(stage, userPrompt),
      elapsedMs: Date.now() - start,
      mock: true,
      retryCount: 0,
    };
  }

  // 有 Key → 真实调用
  try {
    const provider = routeProvider(model);
    const baseUrl = resolveBaseUrl(agent, model);
    const modelName = resolveModelName(agent);
    const systemPrompt = agent.systemPrompt || '你是 Hank Agent Team 的一员，请按要求完成任务。';

    let content: string;
    let retryCount = 0;
    if (provider === 'anthropic') {
      const result = await callAnthropic(baseUrl, agent.apiKey, modelName, systemPrompt, userPrompt);
      content = result.content;
      retryCount = result.retryCount;
    } else if (provider === 'google') {
      const result = await callGoogle(baseUrl, agent.apiKey, modelName, systemPrompt, userPrompt);
      content = result.content;
      retryCount = result.retryCount;
    } else {
      const result = await callOpenAICompat(baseUrl, agent.apiKey, modelName, systemPrompt, userPrompt);
      content = result.content;
      retryCount = result.retryCount;
    }

    return { content: content || '[空响应]', elapsedMs: Date.now() - start, mock: false, retryCount };
  } catch (e: unknown) {
    // 真实调用失败（重试耗尽或不可重试错误） → fallback 到 mock，保证流程不中断
    const msg = e instanceof Error ? e.message : String(e);
    await delay(300);
    return {
      content: mockResponse(stage, userPrompt),
      error: `真实调用失败已降级 mock：${msg}`,
      elapsedMs: Date.now() - start,
      mock: true,
      retryCount: 0,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============ JSON 容错解析 ============
/**
 * 安全 JSON 解析 — 剥离 Markdown 代码块包裹、修复尾部逗号
 * 失败时不抛异常，返回 fallback 并 console.warn
 */
export function safeJsonParse<T>(raw: string, fallback: T): { value: T; success: boolean } {
  let cleaned = raw.trim();
  // 剥离 ```json ... ``` 包裹
  const codeBlock = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlock) cleaned = codeBlock[1].trim();
  // 修复尾部逗号
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  try {
    return { value: JSON.parse(cleaned) as T, success: true };
  } catch {
    console.warn('[safeJsonParse] 解析失败, 原始片段:', cleaned.slice(0, 200));
    return { value: fallback, success: false };
  }
}
