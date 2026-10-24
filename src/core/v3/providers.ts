// ============================================================
// Provider 支持矩阵（厂商端点能力，v3.2）
//
// 与 electron/llm-gateway.cjs 的 DEFAULT_BASE_URL / UNSUPPORTED_PROVIDERS 保持一致：
// main 进程是执行事实源，这里只是 Renderer 侧用于「启动前 preflight」的镜像。
// 任何新增厂商必须两边同时更新，并有契约测试（gateway.contract.test.ts）兜底。
// ============================================================

/** 主进程已配置默认端点的厂商 */
export const SUPPORTED_PROVIDERS: readonly string[] = [
  'OpenAI',
  'Anthropic',
  'Google',
  'DeepSeek',
  '阿里千问',
  '智谱',
  '百度文心',
  '月之暗面',
  'MiniMax',
  '零一万物',
  'Mistral',
  '讯飞星火',
  '字节豆包',
  '百川智能',
];

/** 明确未配置端点的厂商（调用会失败，不允许静默回退） */
export const UNSUPPORTED_PROVIDERS: readonly string[] = ['腾讯混元', 'Meta'];

export function isProviderSupported(provider: string): boolean {
  return SUPPORTED_PROVIDERS.includes(provider);
}

export function isProviderKnown(provider: string): boolean {
  return SUPPORTED_PROVIDERS.includes(provider) || UNSUPPORTED_PROVIDERS.includes(provider);
}
