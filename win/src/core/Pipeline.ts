import {
  PipelineState,
  PipelineStage,
  Agent,
  Department,
  DepartmentInfo,
  ModelConfig,
  Plan,
} from './types';

// 阶段进度映射（复杂档完整流程）
export const STAGE_PROGRESS_FULL: Record<PipelineStage, number> = {
  difficulty_assess: 3,
  init: 8,
  audit_entry: 20,
  extract: 35,
  content_review: 45,
  develop: 60,
  code_review: 72,
  deep_audit: 85,
  deploy: 95,
  done: 100,
};

// 阶段进度映射（中等档）
export const STAGE_PROGRESS_MEDIUM: Record<PipelineStage, number> = {
  difficulty_assess: 3,
  init: 8,
  audit_entry: 18,
  extract: 35,
  content_review: 50,
  develop: 65,
  code_review: 80,
  deep_audit: 90,
  deploy: 97,
  done: 100,
};

// 阶段进度映射（简单档：跳过审查框架相关阶段）
export const STAGE_PROGRESS_SIMPLE: Record<PipelineStage, number> = {
  difficulty_assess: 5,
  init: 15,
  audit_entry: 15,        // 简单档不执行，占位
  extract: 40,
  content_review: 40,     // 简单档不执行，占位
  develop: 70,
  code_review: 70,        // 简单档不执行，占位
  deep_audit: 70,         // 简单档不执行，占位
  deploy: 90,
  done: 100,
};

// 向后兼容：默认使用完整流程进度
export const STAGE_PROGRESS: Record<PipelineStage, number> = STAGE_PROGRESS_FULL;

// 部门定义
export const DEPARTMENTS: DepartmentInfo[] = [
  { id: 'command', name: '指挥部', icon: 'command', agents: [], status: 'idle' },
  { id: 'info', name: '信息部', icon: 'info', agents: [], status: 'idle' },
  { id: 'develop', name: '开发部', icon: 'develop', agents: [], status: 'idle' },
  { id: 'review', name: '审核部', icon: 'review', agents: [], status: 'idle' },
];

// 创建初始Agent列表（含审查框架三大审查员）
export function createAgents(): Agent[] {
  return [
    // 指挥部
    { id: 'cmd-A', name: '指挥A', department: 'command', model: 'hunyuan-hy3', apiKey: '', baseUrl: '', role: 'leader', status: 'idle', currentTask: '', systemPrompt: '你是指挥部小队长，负责统筹全局任务分配与进度监控，确保各部门高效协作。', skills: ['任务调度', '进度监控', '风险预警'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'cmd-B', name: '指挥B', department: 'command', model: 'deepseek-v4', apiKey: '', baseUrl: '', role: 'member', status: 'idle', currentTask: '', systemPrompt: '你是指挥部成员，协助小队长进行决策支持和资源调配。', skills: ['数据分析', '方案评估'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    // 信息部
    { id: 'info-A', name: '信息队长', department: 'info', model: 'hunyuan-lite', apiKey: '', baseUrl: '', role: 'leader', status: 'idle', currentTask: '', systemPrompt: '你是信息部小队长，负责信息收集策略制定和质量把关。', skills: ['信息检索', '数据抓取', '情报分析'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'info-B', name: '信息员B', department: 'info', model: 'deepseek-v3', apiKey: '', baseUrl: '', role: 'member', status: 'idle', currentTask: '', systemPrompt: '你是信息部成员，负责执行信息采集和初步整理。', skills: ['网页抓取', '数据清洗'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    // 开发部
    { id: 'dev-A', name: '开发队长', department: 'develop', model: 'hunyuan-lite', apiKey: '', baseUrl: '', role: 'leader', status: 'idle', currentTask: '', systemPrompt: '你是开发部小队长，负责技术方案设计和代码质量把控。', skills: ['架构设计', '代码审查', '技术选型'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'dev-B', name: '开发员B', department: 'develop', model: 'deepseek-v3', apiKey: '', baseUrl: '', role: 'member', status: 'idle', currentTask: '', systemPrompt: '你是开发部成员，负责功能实现和单元测试编写。', skills: ['前端开发', '后端开发', '测试'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    // 审核部（普通审核 + 审查框架三大审查员）
    { id: 'rev-L', name: '逻辑严谨派', department: 'review', model: 'gpt-4o', apiKey: '', baseUrl: '', role: 'reviewer_logic', status: 'idle', currentTask: '', systemPrompt: '你是审核部的逻辑严谨派审查员。', skills: ['逻辑审查', '漏洞检测'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'rev-F', name: '事实核查派', department: 'review', model: 'claude-3.5', apiKey: '', baseUrl: '', role: 'reviewer_fact', status: 'idle', currentTask: '', systemPrompt: '你是审核部的事实核查派审查员。', skills: ['事实核查', '数据校验'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'rev-U', name: '用户视角派', department: 'review', model: 'gemini-2.5-pro', apiKey: '', baseUrl: '', role: 'reviewer_user', status: 'idle', currentTask: '', systemPrompt: '你是审核部的用户视角派审查员。', skills: ['可用性评估', '完整性检查'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'rev-C', name: '内容审核', department: 'review', model: 'gpt-4o', apiKey: '', baseUrl: '', role: 'member', status: 'idle', currentTask: '', systemPrompt: '你是审核部成员，负责内容质量和合规性审查。', skills: ['内容审查', '合规校验', '质量评估'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
    { id: 'rev-D', name: '代码审核', department: 'review', model: 'claude-3.5', apiKey: '', baseUrl: '', role: 'member', status: 'idle', currentTask: '', systemPrompt: '你是审核部成员，负责代码质量和安全性审核。', skills: ['代码审查', '安全审计', '性能分析'], stats: { tasksCompleted: 0, errors: 0, avgTime: 0 } },
  ];
}

// 全局模型列表 - 预置主流厂商模型，API 配置留空待填
export const DEFAULT_MODELS: ModelConfig[] = [
  // 腾讯混元
  { id: 'hunyuan-hy3', name: 'Hunyuan-Hy3', provider: '腾讯混元' },
  { id: 'hunyuan-t1', name: 'Hunyuan-T1', provider: '腾讯混元' },
  { id: 'hunyuan-lite', name: 'Hunyuan-Lite', provider: '腾讯混元' },
  { id: 'hunyuan-turbo', name: 'Hunyuan-Turbo', provider: '腾讯混元' },
  // DeepSeek
  { id: 'deepseek-v4', name: 'DeepSeek-V4 Pro', provider: 'DeepSeek' },
  { id: 'deepseek-v3', name: 'DeepSeek-V3', provider: 'DeepSeek' },
  { id: 'deepseek-v3.1', name: 'DeepSeek-V3.1', provider: 'DeepSeek' },
  { id: 'deepseek-r1', name: 'DeepSeek-R1', provider: 'DeepSeek' },
  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o-mini', provider: 'OpenAI' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1-Nano', provider: 'OpenAI' },
  { id: 'o3', name: 'o3', provider: 'OpenAI' },
  { id: 'o4-mini', name: 'o4-mini', provider: 'OpenAI' },
  // Anthropic
  { id: 'claude-3.5', name: 'Claude-3.5-Sonnet', provider: 'Anthropic' },
  { id: 'claude-4', name: 'Claude-4-Opus', provider: 'Anthropic' },
  { id: 'claude-haiku', name: 'Claude-3.5-Haiku', provider: 'Anthropic' },
  // Google
  { id: 'gemini-2.5-pro', name: 'Gemini-2.5-Pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', name: 'Gemini-2.5-Flash', provider: 'Google' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini-2.5-Flash-Lite', provider: 'Google' },
  // 阿里千问
  { id: 'qwen-3-max', name: 'Qwen-3-Max', provider: '阿里千问' },
  { id: 'qwen-3-turbo', name: 'Qwen-3-Turbo', provider: '阿里千问' },
  { id: 'qwen-3-coder', name: 'Qwen-3-Coder', provider: '阿里千问' },
  { id: 'qwen-2.5-72b', name: 'Qwen-2.5-72B', provider: '阿里千问' },
  { id: 'qwen-2.5-coder', name: 'Qwen-2.5-Coder-32B', provider: '阿里千问' },
  // 智谱 GLM
  { id: 'glm-4.5', name: 'GLM-4.5', provider: '智谱' },
  { id: 'glm-4-flash', name: 'GLM-4-Flash', provider: '智谱' },
  { id: 'glm-4-air', name: 'GLM-4-Air', provider: '智谱' },
  // 百度文心
  { id: 'ernie-4.0-turbo', name: 'ERNIE-4.0-Turbo', provider: '百度文心' },
  { id: 'ernie-4.5', name: 'ERNIE-4.5', provider: '百度文心' },
  { id: 'ernie-3.5', name: 'ERNIE-3.5', provider: '百度文心' },
  { id: 'ernie-speed', name: 'ERNIE-Speed', provider: '百度文心' },
  // 字节豆包
  { id: 'doubao-pro', name: '豆包-Pro', provider: '字节豆包' },
  { id: 'doubao-lite', name: '豆包-Lite', provider: '字节豆包' },
  // 讯飞星火
  { id: 'spark-4.0', name: '星火-4.0', provider: '讯飞星火' },
  { id: 'spark-3.5', name: '星火-3.5', provider: '讯飞星火' },
  // 百川
  { id: 'baichuan-4', name: '百川-4', provider: '百川智能' },
  { id: 'baichuan-3', name: '百川-3', provider: '百川智能' },
  // Mistral
  { id: 'mistral-large', name: 'Mistral-Large', provider: 'Mistral' },
  { id: 'mistral-small', name: 'Mistral-Small', provider: 'Mistral' },
  { id: 'codestral', name: 'Codestral', provider: 'Mistral' },
  // Meta
  { id: 'llama-4-scout', name: 'Llama-4-Scout', provider: 'Meta' },
  // 零一万物
  { id: 'yi-large-turbo', name: 'Yi-Large-Turbo', provider: '零一万物' },
  // 月之暗面
  { id: 'moonshot-v1', name: 'Moonshot-v1', provider: '月之暗面' },
  // MiniMax
  { id: 'abab-6.5', name: 'ABAB-6.5', provider: 'MiniMax' },
];

// 创建初始流水线状态
export function createInitialState(): PipelineState {
  return {
    stage: 'difficulty_assess',
    taskId: '',
    progress: 0,
    agents: createAgents(),
    tasks: [],
    log: [],
    errors: [],
    paused: false,
    isRunning: false,
    contentRejectCount: 0,
    codeRejectCount: 0,
    models: [...DEFAULT_MODELS],
    userInput: '',
    plan: null,
    stageOutputs: {},
    messages: [],
    // 新增：难度与审查框架
    difficulty: null,
    difficultyReason: '',
    reviewFramework: null,
    monitorEvents: [],
    reviewAuditCount: 0,
  };
}

// 更新Agent状态
export function updateAgentStatus(
  agents: Agent[],
  agentId: string,
  updates: Partial<Pick<Agent, 'status' | 'currentTask' | 'stats'>>
): Agent[] {
  return agents.map(a => {
    if (a.id !== agentId) return a;
    return { ...a, ...updates, stats: updates.stats ? { ...a.stats, ...updates.stats } : a.stats };
  });
}

// 获取部门Agent
export function getDeptAgents(agents: Agent[], dept: Department): Agent[] {
  return agents.filter(a => a.department === dept);
}

// 获取部门Leader
export function getDeptLeader(agents: Agent[], dept: Department): Agent | undefined {
  return agents.find(a => a.department === dept && a.role === 'leader');
}

// 切换Agent模型
export function switchAgentModel(agents: Agent[], agentId: string, newModelId: string): Agent[] {
  return agents.map(a => a.id === agentId ? { ...a, model: newModelId } : a);
}

// 获取模型显示名
export function getModelDisplayName(models: ModelConfig[], modelId: string): string {
  const model = models.find(m => m.id === modelId);
  return model?.name ?? modelId;
}

// 添加模型
export function addModel(models: ModelConfig[], config: ModelConfig): ModelConfig[] {
  if (models.some(m => m.id === config.id)) return models;
  return [...models, config];
}

// 移除模型
export function removeModel(models: ModelConfig[], modelId: string): ModelConfig[] {
  return models.filter(m => m.id !== modelId);
}

// 更新模型配置
export function updateModel(models: ModelConfig[], modelId: string, updates: Partial<ModelConfig>): ModelConfig[] {
  return models.map(m => m.id === modelId ? { ...m, ...updates, id: modelId } : m);
}

// 添加Agent
export function addAgent(agents: Agent[], agent: Agent): Agent[] {
  return [...agents, agent];
}

// 移除Agent
export function removeAgent(agents: Agent[], agentId: string): Agent[] {
  return agents.filter(a => a.id !== agentId);
}

// 更新Agent（提示词、技能、角色、名称、模型等）
export function updateAgent(agents: Agent[], agentId: string, updates: Partial<Agent>): Agent[] {
  return agents.map(a => a.id === agentId ? { ...a, ...updates } : a);
}
