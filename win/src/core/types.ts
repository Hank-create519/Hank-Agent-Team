// Agent 状态
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'done' | 'error';

// 部门类型
export type Department = 'command' | 'info' | 'develop' | 'review';

// Agent 实例
export interface Agent {
  id: string;
  name: string;
  department: Department;
  model: string;
  apiKey: string;
  baseUrl: string;
  role: 'leader' | 'member' | 'reviewer_logic' | 'reviewer_fact' | 'reviewer_user';
  status: AgentStatus;
  currentTask: string;
  systemPrompt: string;
  /** 静态技能标签列表，由 Skill Registry (P1-3) 消费注入 system prompt；动态分配结果见 assignedSkills (P1-5) */
  skills: string[];
  /** 指挥 Agent 根据任务动态分配的技能 ID 列表 (P1-5)，优先级高于 skills */
  assignedSkills?: string[];
  stats: { tasksCompleted: number; errors: number; avgTime: number };
}

// 部门
export interface DepartmentInfo {
  id: Department;
  name: string;
  icon: string;
  agents: Agent[];
  status: AgentStatus;
}

// 任务
export interface Task {
  id: string;
  title: string;
  description: string;
  from: Department;
  to: Department;
  status: 'pending' | 'running' | 'review' | 'passed' | 'rejected' | 'done';
  result?: string;
  errors?: string[];
}

// 难度档位
export type Difficulty = 'simple' | 'medium' | 'complex';

// 流水线阶段
export type PipelineStage =
  | 'difficulty_assess'  // 指挥部难度评估（新增）
  | 'init'               // 指挥部制定方案
  | 'audit_entry'        // 审查框架深度把关（方案级）
  | 'extract'            // 信息部提取
  | 'content_review'     // 审核部内容审核
  | 'develop'            // 开发部编码
  | 'code_review'        // 审核部代码审核
  | 'deep_audit'         // 系统级兜底深度审计（代码级·审查框架）
  | 'deploy'             // 部署
  | 'done';              // 完成

// 模型配置（仅元数据，API Key 由各 Agent 独立配置）
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
}

// ============ 审查框架类型（从瀚海移植 + 适配四部门架构） ============

// 审查框架执行阶段
export type ReviewPhase = 'idle' | 'prep_extract' | 'prep_judge' | 'debate' | 'summary' | 'done';

// 审查员意见
export interface ReviewerOpinion {
  reviewerKey: 'logic' | 'fact' | 'user';
  roleName: string;
  content: string;         // 完整意见文本
  score: number;            // 打分 1-10
  keyIssues: string[];       // 核心问题列表
  elapsedMs: number;
  timestamp: string;
}

// 一轮审查
export interface ReviewRound {
  round: number;
  reviewers: {
    logic: ReviewerOpinion | null;
    fact: ReviewerOpinion | null;
    user: ReviewerOpinion | null;
  };
  integration: string;          // 阶段性总结AI 汇总
  needNextRound: boolean;        // 是否需要下一轮
  divergenceDegree: number;      // 分歧度 0-1
  elapsedMs: number;
}

// 最终审查报告（对齐提示词总结层输出）
export interface FinalReviewReport {
  pros: string[];                   // 做得好的地方
  issues: IssueItem[];              // 存在的问题（按严重程度排序）
  suggestions: string[];           // 具体的修改建议
  verdict: 'pass' | 'conditional' | 'reject';
  totalRounds: number;
  totalElapsedMs: number;
  generatedAt: string;
}

export interface IssueItem {
  severity: 'high' | 'medium' | 'low';
  desc: string;
}

// ============ Skill Registry (P1-3) ============
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;       // 供 LLM 理解用途
  parameters?: {             // JSON Schema 参数定义
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  systemPromptSnippet: string; // 激活时注入的 system prompt 片段
}

// 审查框架完整状态
export interface ReviewFrameworkState {
  phase: ReviewPhase;
  triggerPoint: 'plan' | 'code';      // 触发点：方案审查 / 代码兜底
  depth: 'single' | 'full';         // 单轮 / 多轮
  difficulty: Difficulty;
  // 准备层
  extraction: string | null;          // 信息提取AI 结果
  extraction2: string | null;         // 反向提取AI 结果
  roundJudge: string | null;          // 判定能力AI 结果
  totalRounds: number;               // 预估/实际审查轮数
  // 判定层
  rounds: ReviewRound[];
  // 总结层
  finalReport: FinalReviewReport | null;
  // 运行时
  isRunning: boolean;
  elapsedMs: number;
}

// 审查框架输出结果（供 Engine 使用）
export interface ReviewFrameworkResult {
  report: FinalReviewReport;
  state: ReviewFrameworkState;
}

// 难度评估结果
export interface DifficultyAssessment {
  difficulty: Difficulty;
  reason: string;
  estimatedRounds: number;
  enableReviewFramework: boolean;   // 是否启用审查框架
}

// 监控事件（用户穿透）
export interface MonitorEvent {
  id: string;
  time: string;
  type: 'dept_message' | 'review_opinion' | 'difficulty_assess' | 'framework_phase' | 'user_intervention' | 'retry_attempt' | 'context_truncated' | 'plan_validation';
  department: Department;
  agentName: string;
  content: string;
  metadata?: Record<string, any>;
}

// 流水线状态
export interface PipelineState {
  stage: PipelineStage;
  taskId: string;
  progress: number;        // 0-100
  agents: Agent[];
  tasks: Task[];
  log: LogEntry[];
  errors: string[];
  paused: boolean;
  isRunning: boolean;              // 引擎运行中
  contentRejectCount: number;      // 内容审核打回次数，超3自动暂停
  codeRejectCount: number;         // 代码审核打回次数，超3自动暂停
  models: ModelConfig[];           // 全局模型注册表
  userInput: string;               // 用户原始需求
  plan: Plan | null;               // 指挥部方案
  stageOutputs: Partial<Record<PipelineStage, StageOutput>>; // 各阶段实际产出存档
  messages: LogEntry[];            // 部门间通信记录（区别于 log）
  // 新增：难度与审查框架
  difficulty: Difficulty | null;
  difficultyReason: string;
  reviewFramework: ReviewFrameworkState | null;
  monitorEvents: MonitorEvent[];
  reviewAuditCount: number;        // 审查框架已执行次数
  chatMessages?: ChatMessage[];    // 对话面板消息（ChatPanel 专用）
}

// 单阶段产出存档
export interface StageOutput {
  stage: PipelineStage;
  agentId: string;
  agentName: string;
  department: Department;
  content: string;       // 原始产出文本
  summary: string;       // 一句话摘要
  status: 'running' | 'done' | 'error';
  elapsedMs: number;
  timestamp: string;
}

// 对话面板消息（ChatPanel）
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  name: string;
  content: string;
  timestamp: number;
  action?: { type: string };
}

// 日志
export interface LogEntry {
  time: string;
  agentId: string;
  agentName?: string;
  department: Department;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'dept_message';
}

// 指挥部方案
export interface Plan {
  summary: string;
  /** 暂未消费，待 ConstitutionGuard (P1-2) 作为动态流水线的执行来源 */
  steps: PipelineStage[];
  risks: string[];
  suggestedApproach: string;
}

// 审核反馈
export interface AuditFeedback {
  approved: boolean;
  issues: string[];
  suggestions: string[];
}
