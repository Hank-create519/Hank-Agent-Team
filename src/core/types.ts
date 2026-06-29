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
  role: 'leader' | 'member';
  status: AgentStatus;
  currentTask: string;
  systemPrompt: string;
  skills: string[];
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

// 流水线阶段
export type PipelineStage =
  | 'init'           // 指挥部制定方案
  | 'audit_entry'    // 审查系统把关
  | 'extract'        // 信息部提取
  | 'content_review'  // 审核部内容审核
  | 'develop'        // 开发部编码
  | 'code_review'    // 审核部代码审核
  | 'deploy'         // 部署
  | 'done';          // 完成

// 模型配置（仅元数据，API Key 由各 Agent 独立配置）
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
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
  reviewRejectCount: number;       // 审核打回次数，超3自动暂停
  models: ModelConfig[];           // 全局模型注册表
  userInput: string;               // 用户原始需求
  plan: Plan | null;               // 指挥部方案
  stageOutputs: Partial<Record<PipelineStage, StageOutput>>; // 各阶段实际产出存档
  messages: LogEntry[];            // 部门间通信记录（区别于 log）
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

// 日志
export interface LogEntry {
  time: string;
  agentId: string;
  agentName?: string;
  department: Department;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

// 指挥部方案
export interface Plan {
  summary: string;
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
