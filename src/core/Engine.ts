// ============================================================
// 流水线执行引擎 V1.0.1 —— 难度分流 + 审查框架集成
// 对齐系统提示词：
//   第一步 难度分流（简单/中等/复杂）
//   第二步 方案精炼（审查框架介入）
//   第三步 三部门协同
//   第四步 双重审计防线（部门级 + 系统级审查框架兜底）
//   第五步 终审交付
//   第六步 动态迭代
// ============================================================

import {
  PipelineState, PipelineStage, Agent, Department, ModelConfig, Plan, LogEntry, StageOutput,
  Difficulty, ReviewPhase, MonitorEvent, FinalReviewReport, IssueItem,
} from './types';
import {
  STAGE_PROGRESS_FULL, STAGE_PROGRESS_MEDIUM, STAGE_PROGRESS_SIMPLE,
  createInitialState,
} from './Pipeline';
import { callLLM } from './llm';
import { safeJsonParse } from './llm';
import { getSkills } from './skillRegistry';
import { listSkills } from './skillRegistry';
import { mockSummary } from './mockResponses';
import { assessDifficulty } from './difficultyRouter';
import { runReviewFramework } from './ReviewFramework';
import { parseReviewResult as parseReviewOutput } from './utils/review-parse';
import { runGraph } from './v3/runtime';
import { chooseGraph, validateGraph, describeGraph, CAPABILITY_META } from './v3/graph';
import { runReview } from './v3/review';
import { invokeLLM, createBudget, type InvokeBudget } from './v3/invoke';
import { agentRouter, DEPARTMENT_BY_CAPABILITY } from './v3/agentRouter';
import { buildContext, type ContextSource, type ContextBuildResult } from './v3/context';
import { evaluateVerify } from './v3/verify';
import { isProviderKnown, isProviderSupported } from './v3/providers';
import type { CapabilityId, GateResult, NodeOutput, NodeResult, NodeSpec, TaskGraph } from './v3/types';

// ============ 阶段 → 负责部门映射 ============
const STAGE_DEPT: Record<PipelineStage, Department> = {
  difficulty_assess: 'command',
  init: 'command',
  audit_entry: 'review',
  extract: 'info',
  content_review: 'review',
  develop: 'develop',
  code_review: 'review',
  deep_audit: 'review',
  deploy: 'develop',
  done: 'command',
};

// 阶段中文标签
export const STAGE_LABELS: Record<PipelineStage, string> = {
  difficulty_assess: '难度评估',
  init: '制定方案',
  audit_entry: '审查框架把关',
  extract: '信息提取',
  content_review: '内容审核',
  develop: '开发编码',
  code_review: '代码审核',
  deep_audit: '系统级深度审计',
  // 未接入真实部署执行器：本阶段产出仅为部署说明，不产生"已部署"的事实
  deploy: '部署说明（未接入执行器）',
  done: '完成交付',
};

const DEPT_NAME: Record<Department, string> = {
  command: '指挥部', info: '信息部', develop: '开发部', review: '审核部',
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  simple: '简单档',
  medium: '中等档',
  complex: '复杂档',
};

// ============ 引擎状态 ============
let _state: PipelineState = createInitialState();
let _listeners: Set<() => void> = new Set();
let _abortController: AbortController | null = null;
let _pausedResolve: (() => void) | null = null;

function notify() {
  _listeners.forEach(fn => fn());
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function getState(): Readonly<PipelineState> {
  return _state;
}

// 用外部配置（agents/models）初始化引擎（启动时由 App 注入）
export function syncFromApp(state: PipelineState) {
  _state = { ..._state, agents: state.agents, models: state.models };
}

// 根据难度选择进度表
function progressTable(): Record<PipelineStage, number> {
  if (_state.difficulty === 'simple') return STAGE_PROGRESS_SIMPLE;
  if (_state.difficulty === 'medium') return STAGE_PROGRESS_MEDIUM;
  return STAGE_PROGRESS_FULL;
}

// ============ 辅助 ============
function pickAgent(dept: Department): Agent {
  const deptAgents = _state.agents.filter(a => a.department === dept);
  const agent = deptAgents.find(a => a.role === 'leader') || deptAgents[0];
  if (!agent) throw new Error(`部门「${DEPT_NAME[dept]}」没有可用 Agent，请在团队配置中添加`);
  return agent;
}

function setAgentStatus(agentId: string, status: Agent['status'], currentTask = '') {
  _state = {
    ..._state,
    agents: _state.agents.map(a =>
      a.id === agentId ? { ...a, status, currentTask } : a
    ),
  };
}

function addLog(agent: Agent | null, department: Department, message: string, type: LogEntry['type'] = 'info') {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    agentId: agent?.id || '',
    agentName: agent?.name || DEPT_NAME[department],
    department,
    message,
    type,
  };
  _state = { ..._state, log: [..._state.log, entry].slice(-200) };
}

function addMessage(from: Department, to: Department, msgType: 'task' | 'result' | 'review' | 'error' | 'ack', message: string) {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    agentId: '',
    agentName: DEPT_NAME[from],
    department: from,
    message: `→ ${DEPT_NAME[to]}：${message}`,
    type: msgType === 'error' ? 'error' : msgType === 'review' ? 'warning' : 'info',
  };
  _state = { ..._state, messages: [..._state.messages, entry].slice(-200) };
}

function setStage(stage: PipelineStage) {
  const table = progressTable();
  _state = { ..._state, stage, progress: table[stage] ?? 0 };
}

function saveStageOutput(stage: PipelineStage, agent: Agent, content: string, summary: string, status: StageOutput['status'], elapsedMs: number, source: StageOutput['source'] = 'live') {
  const out: StageOutput = {
    stage, agentId: agent.id, agentName: agent.name,
    department: agent.department, content, summary, status, source, elapsedMs,
    timestamp: new Date().toISOString(),
  };
  _state = { ..._state, stageOutputs: { ..._state.stageOutputs, [stage]: out } };
  _persist('stageOutputs', out);
}

// 监控事件记录（用户穿透）
function recordMonitorEvent(
  type: MonitorEvent['type'],
  department: Department,
  agentName: string,
  content: string,
  metadata?: Record<string, unknown>,
) {
  const evt: MonitorEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    type, department, agentName, content,
    metadata,
  };
  _state = { ..._state, monitorEvents: [..._state.monitorEvents, evt].slice(-300) };
}

// 码点安全切片：避免把 emoji 等代理对从中间切开产生乱码
export function sliceCodePointSafe(str: string, start: number, end: number): string {
  let s = Math.max(0, Math.min(start, str.length));
  let e = Math.max(s, Math.min(end, str.length));
  while (s < e && str.charCodeAt(s) >= 0xDC00 && str.charCodeAt(s) <= 0xDFFF) s++;
  while (e > s && str.charCodeAt(e - 1) >= 0xD800 && str.charCodeAt(e - 1) <= 0xDBFF) e--;
  return str.slice(s, e);
}

// 暂停门控
async function waitIfPaused() {
  while (_state.paused) {
    await new Promise<void>(resolve => { _pausedResolve = resolve; });
    if (_abortController?.signal.aborted) return;
  }
}

const aborted = () => _abortController?.signal.aborted;

// ============ 单阶段执行 ============
async function runStage(stage: PipelineStage, userPrompt: string, opts?: { forceAgent?: Agent }): Promise<string> {
  if (aborted()) return '';
  await waitIfPaused();
  if (aborted()) return '';

  // 上下文窗口溢出保护：超出阈值时保留头部 + 尾部（码点安全，不切开代理对）
  const MAX_PROMPT_LEN = 32000; // 保守值，约 8000 tokens
  let finalPrompt = userPrompt;
  if (userPrompt.length > MAX_PROMPT_LEN) {
    const head = sliceCodePointSafe(userPrompt, 0, Math.floor(MAX_PROMPT_LEN * 2 / 3));
    const tail = sliceCodePointSafe(userPrompt, userPrompt.length - Math.floor(MAX_PROMPT_LEN / 3), userPrompt.length);
    finalPrompt = head + '\n\n[中间内容已截断...]\n\n' + tail;
    addLog(null, STAGE_DEPT[stage],
      `[上下文截断] ${stage} 阶段输入从 ${userPrompt.length} 截断至 ${finalPrompt.length} 字符`, 'warning');
  }

  const dept = STAGE_DEPT[stage];
  const agent = opts?.forceAgent || pickAgent(dept);
  if (!agent) throw new Error(`${DEPT_NAME[dept]} 没有可用 Agent`);

  setStage(stage);
  setAgentStatus(agent.id, 'running', STAGE_LABELS[stage]);
  addLog(agent, dept, `开始执行「${STAGE_LABELS[stage]}」`, 'info');
  recordMonitorEvent('framework_phase', dept, agent.name, `开始「${STAGE_LABELS[stage]}」`);
  notify();

  const start = Date.now();

  // P1-3/P1-5: 注入 Skill system prompt 片段
  let effectiveAgent = agent;
  const activeSkillIds = agent.assignedSkills && agent.assignedSkills.length > 0
    ? agent.assignedSkills   // P1-5 动态分配优先
    : agent.skills;
  const activeSkillDefs = getSkills(activeSkillIds);
  if (activeSkillDefs.length > 0) {
    const skillSnippets = activeSkillDefs
      .map(s => s.systemPromptSnippet)
      .join('\n\n');
    effectiveAgent = {
      ...agent,
      systemPrompt: `${agent.systemPrompt}\n\n${skillSnippets}`,
    };
  }

  // 真实调用。失败时不降级 mock：标记阶段失败并暂停，
  // 用户「继续」= 重试本阶段，「停止」= 中止任务。
  let result = await callLLM(effectiveAgent, _state.models, stage, finalPrompt, _abortController?.signal, { demo: _state.runMode === 'demo', taskId: _state.taskId, nodeId: `legacy:${stage}` });
  while (result.status === 'failed') {
    setAgentStatus(agent.id, 'error', STAGE_LABELS[stage]);
    saveStageOutput(stage, agent, '', `调用失败：${result.error || '未知错误'}`, 'error', 0, 'live');
    addLog(agent, dept, `LLM 调用失败：${result.error || '未知错误'}。已暂停 —— 点击「继续」重试本阶段，或「停止」结束任务。`, 'error');
    recordMonitorEvent('api_failure', dept, agent.name,
      `「${STAGE_LABELS[stage]}」真实调用失败，暂停等待处理`, { stage, error: result.error });
    _state = { ..._state, paused: true, pauseReason: 'api-retry' };
    notify();
    await waitIfPaused();
    if (aborted()) throw new DOMException('Aborted', 'AbortError');
    setAgentStatus(agent.id, 'running', STAGE_LABELS[stage]);
    addLog(agent, dept, `重试「${STAGE_LABELS[stage]}」`, 'info');
    notify();
    result = await callLLM(effectiveAgent, _state.models, stage, finalPrompt, _abortController?.signal, { demo: _state.runMode === 'demo', taskId: _state.taskId, nodeId: `legacy:${stage}` });
  }
  const elapsedMs = Date.now() - start;
  const source: StageOutput['source'] = result.status === 'demo' ? 'demo' : 'live';

  // P1-4: 记录重试事件
  if (result.retryCount > 0) {
    recordMonitorEvent('retry_attempt', dept, agent.name,
      `LLM 调用经 ${result.retryCount} 次重试后成功（${stage} 阶段）`,
      { retryCount: result.retryCount, stage });
  }

  setAgentStatus(agent.id, 'done');
  const summary = extractSummary(stage, result.content);

  saveStageOutput(stage, agent, result.content, summary, 'done', elapsedMs, source);
  addLog(agent, dept, `「${STAGE_LABELS[stage]}」完成 (${elapsedMs}ms${source === 'demo' ? ' · 演示模式' : ''})`, 'success');
  notify();

  return result.content;
}

// 从产出文本提取一句话摘要
function extractSummary(stage: PipelineStage, content: string): string {
  if (content.includes('【')) return mockSummary(stage);
  const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('```'));
  return firstLine ? firstLine.trim().slice(0, 80) : mockSummary(stage);
}

// ============ ConstitutionGuard: 阶段依赖图谱与校验 ============
const STAGE_DEPENDENCIES: Partial<Record<PipelineStage, PipelineStage[]>> = {
  audit_entry: ['init'],
  content_review: ['extract'],
  code_review: ['develop'],
  deep_audit: ['code_review'],
  deploy: ['develop', 'code_review'],
  done: ['deploy'],
};

export function validatePlan(steps: PipelineStage[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const allowed: PipelineStage[] = ['difficulty_assess', 'init', 'audit_entry', 'extract', 'content_review', 'develop', 'code_review', 'deep_audit', 'deploy', 'done'];
  if (!Array.isArray(steps) || steps.length === 0) return { valid: false, errors: ['计划阶段必须是非空数组'] };
  const seen = new Set<PipelineStage>();
  for (const step of steps) {
    if (!allowed.includes(step)) {
      errors.push(`计划包含未知阶段「${String(step)}」`);
      continue;
    }
    if (seen.has(step)) errors.push(`计划重复包含阶段「${STAGE_LABELS[step]}」`);

    const deps = STAGE_DEPENDENCIES[step];
    if (deps) {
      for (const dep of deps) {
        if (!seen.has(dep)) errors.push(`阶段「${STAGE_LABELS[step]}」依赖「${STAGE_LABELS[dep]}」但后者未出现在计划中`);
      }
    }
    seen.add(step);
  }
  const requiredOrder: PipelineStage[] = ['extract', 'content_review', 'develop', 'code_review', 'deep_audit', 'deploy', 'done'];
  let lastIndex = -1;
  for (const stage of requiredOrder) {
    const index = steps.indexOf(stage);
    if (index >= 0) {
      if (index < lastIndex) errors.push(`阶段「${STAGE_LABELS[stage]}」顺序错误`);
      lastIndex = index;
    }
  }
  for (const required of ['extract', 'content_review', 'develop', 'code_review', 'deploy', 'done'] as PipelineStage[]) {
    if (!seen.has(required)) errors.push(`计划缺少必需阶段「${STAGE_LABELS[required]}」`);
  }
  if (_state.difficulty === 'complex' && !seen.has('deep_audit')) errors.push('复杂任务必须包含深度审计');
  if (seen.has('deep_audit') && steps.indexOf('deep_audit') < steps.indexOf('code_review')) errors.push('深度审计必须在代码审核之后');
  const result = { valid: errors.length === 0, errors };
  if (!result.valid) {
    recordMonitorEvent('plan_validation', 'command', 'ConstitutionGuard',
      `Plan.steps 校验失败：${errors.join('；')}`, { errors });
  }
  return result;
}function buildPlanStepContext(userInput: string): string {
  const parts: string[] = [`需求：${userInput}`];
  if (_state.plan) {
    parts.push(`\n方案摘要：${_state.plan.summary}`);
  }
  const prevStages: PipelineStage[] = ['init', 'audit_entry', 'extract', 'content_review', 'develop', 'code_review', 'deep_audit'];
  for (const s of prevStages) {
    const out = _state.stageOutputs[s];
    if (out?.content) {
      parts.push(`\n[${STAGE_LABELS[s]}] 产出：\n${out.content.slice(0, 3000)}`);
    }
  }
  return parts.join('\n');
}

// ============ 审核打回判定 ============
// 解析逻辑统一在 utils/review-parse（v3 审查服务复用同一份）。
export function parseReviewResult(content: string): { approved: boolean; issues: string[] } {
  return parseReviewOutput(content);
}

// 门禁统一入口：解析审核结论，并检查产出来源。
// live 任务中，demo/降级来源的审核产出一律不得判定为通过。
function gateReview(stage: PipelineStage, reviewOutput: string): { approved: boolean; issues: string[] } {
  const { approved, issues } = parseReviewResult(reviewOutput);
  if (approved && _state.runMode === 'live' && _state.stageOutputs[stage]?.source !== 'live') {
    return { approved: false, issues: ['审核产出为演示/降级来源，不得通过真实任务门禁'] };
  }
  return { approved, issues };
}

// ============ 审查框架执行（封装进度回调和状态同步） ============
async function executeReviewFramework(
  input: string,
  triggerPoint: 'plan' | 'code',
  signal?: AbortSignal,
): Promise<void> {
  const reviewAgents = _state.agents.filter(a => a.department === 'review');
  if (reviewAgents.length === 0) throw new Error('审核部没有可用 Agent，无法执行审查框架');

  setStage('audit_entry');
  const depth = _state.difficulty === 'complex' ? 'full' : 'single';
  addLog(null, 'review', `启动审查框架（${triggerPoint === 'plan' ? '方案' : '代码'}级 · ${depth === 'full' ? '多轮' : '单轮'}）`, 'info');
  recordMonitorEvent('framework_phase', 'review', '审查框架', `启动 ${depth === 'full' ? '多轮深度' : '单轮'} 审查`);
  notify();

  // 标记三个审查员为 running
  ['reviewer_logic', 'reviewer_fact', 'reviewer_user'].forEach(role => {
    const a = _state.agents.find(x => x.department === 'review' && x.role === role);
    if (a) setAgentStatus(a.id, 'running', '审查框架');
  });
  notify();

  const { state: rfState, report } = await runReviewFramework({
    difficulty: _state.difficulty || 'medium',
    triggerPoint,
    input,
    reviewAgents,
    models: _state.models,
    onProgress: (phase: ReviewPhase, detail?: string) => {
      if (aborted()) return;
      const phaseLabel: Record<ReviewPhase, string> = {
        idle: '待机', prep_extract: '准备层·信息提取', prep_judge: '准备层·轮次判定',
        debate: '判定层·交叉审查', summary: '总结层·生成报告', done: '完成',
      };
      addLog(null, 'review', `[审查框架] ${phaseLabel[phase]}${detail ? ' · ' + detail : ''}`, 'info');
      // 修复 TDZ：此处不能读取解构中的 rfState（尚未初始化），只同步已有状态用于实时展示。
      if (_state.reviewFramework) {
        _state.reviewFramework = { ..._state.reviewFramework, phase };
      }
      notify();
    },
    signal,
  });

  // 同步审查框架完整状态到引擎
  _state.reviewFramework = rfState;
  _state.reviewAuditCount += 1;

  // 重置审查员状态
  _state.agents.forEach(a => {
    if (a.department === 'review') setAgentStatus(a.id, 'done', '审查框架完成');
  });

  // 根据裁决结果记录
  const verdictLabel = { pass: '✅ 通过', conditional: '⚠️ 有条件通过', reject: '❌ 驳回' }[report.verdict];
  addLog(null, 'review', `审查框架完成：${verdictLabel}（${report.totalRounds} 轮，${report.totalElapsedMs}ms）`, report.verdict === 'reject' ? 'warning' : 'success');
  recordMonitorEvent('review_opinion', 'review', '首席裁决官', `最终裁决：${verdictLabel}`, {
    verdict: report.verdict,
    rounds: report.totalRounds,
    issues: report.issues,
  });

  // 把审查报告作为阶段产出存档
  const leader = pickAgent('review');
  const reportContent = formatReviewReport(report);
  saveStageOutput(triggerPoint === 'plan' ? 'audit_entry' : 'deep_audit', leader, reportContent,
    `审查框架裁决：${verdictLabel}`, 'done', report.totalElapsedMs, report.degraded ? 'demo' : 'live');

  notify();
}

// 格式化审查报告为可读文本
function formatReviewReport(report: FinalReviewReport): string {
  const lines: string[] = ['【审查框架 · 最终报告】', ''];
  lines.push(`裁决：${report.verdict === 'pass' ? '✅ 通过' : report.verdict === 'conditional' ? '⚠️ 有条件通过' : '❌ 驳回'}`);
  lines.push(`审查轮数：${report.totalRounds}　耗时：${report.totalElapsedMs}ms`);
  lines.push('');
  if (report.pros?.length) {
    lines.push('## 做得好的地方');
    report.pros.forEach((p: string) => lines.push(`- ${p}`));
    lines.push('');
  }
  if (report.issues?.length) {
    lines.push('## 存在的问题（按严重程度）');
    report.issues.forEach((i: IssueItem) => {
      const tag = i.severity === 'high' ? '🔴 高' : i.severity === 'medium' ? '🟡 中' : '🟢 低';
      lines.push(`- [${tag}] ${i.desc}`);
    });
    lines.push('');
  }
  if (report.suggestions?.length) {
    lines.push('## 修改建议');
    report.suggestions.forEach((s: string) => lines.push(`- ${s}`));
  }
  return lines.join('\n');
}

// ============ 主流程（对齐提示词六步） ============
/** 任务开始时的状态复位（legacy 与 v3 共用） */
function beginTask(userInput: string): boolean {
  if (_state.isRunning) return false;
  _abortController = new AbortController();
  _pausedResolve = null;
  _state = {
    ..._state,
    isRunning: true,
    paused: false,
    userInput,
    taskId: `task_${Date.now()}`,
    stage: 'difficulty_assess',
    progress: 0,
    log: [],
    messages: [],
    errors: [],
    stageOutputs: {},
    plan: null,
    contentRejectCount: 0,
    codeRejectCount: 0,
    difficulty: null,
    difficultyReason: '',
    reviewFramework: null,
    nodeOutputs: {},
    monitorEvents: [],
    reviewAuditCount: 0,
    // 运行模式：桌面端 + 任一 Agent 已配置密钥 = live；否则演示。
    // live 任务中 demo 来源产出不得通过门禁。
    runMode: (typeof window !== 'undefined'
      && !!(window as unknown as { electronAPI?: { llmCall?: unknown } }).electronAPI?.llmCall
      && _state.agents.some(a => a.hasKey)) ? 'live' : 'demo',
    pauseReason: undefined,
    difficultyDegraded: false,
  };

  _state = { ..._state, agents: _state.agents.map(a => ({ ...a, status: 'idle', currentTask: '' })) };
  notify();
  return true;
}

async function startPipelineLegacy(userInput: string) {
  if (!beginTask(userInput)) return;
  try {
    // ========================================================
    // 第一步：难度分流
    // ========================================================
    setStage('difficulty_assess');
    const cmdAgent = pickAgent('command');
    setAgentStatus(cmdAgent.id, 'running', '难度评估');
    addLog(cmdAgent, 'command', '指挥部启动难度评估', 'info');
    notify();

    const assessment = await assessDifficulty(userInput, cmdAgent, _state.models, _abortController?.signal, {
    demo: _state.runMode === 'demo',
    budget: _v3Budget,
    taskId: _state.taskId,
  });
    if (aborted()) return;

    if (assessment.degraded) {
      addLog(cmdAgent, 'command', '难度评估降级：LLM 调用失败，已使用关键词兜底判定（审核强度不低于中等档）', 'warning');
      recordMonitorEvent('difficulty_assess', 'command', cmdAgent.name,
        '难度评估降级：API 失败，使用关键词兜底', { degraded: true, difficulty: assessment.difficulty });
    }
    _state.difficultyDegraded = !!assessment.degraded;
    // demo 模式下深度审计恒为 conditional，复杂档永远无法交付；演示统一按中等档跑，避免"演示必卡死"
    if (_state.runMode === 'demo' && assessment.difficulty === 'complex') {
      _state.difficulty = 'medium';
      _state.difficultyReason = `${assessment.reason}（演示模式：复杂档按中等档执行）`;
      addLog(cmdAgent, 'command', '演示模式下复杂任务按中等档执行（深度审计需要真实模型）', 'warning');
    } else {
      _state.difficulty = assessment.difficulty;
      _state.difficultyReason = assessment.reason;
    }
    setAgentStatus(cmdAgent.id, 'done');
    addLog(cmdAgent, 'command',
      `难度评估：${DIFFICULTY_LABEL[assessment.difficulty]}（${assessment.reason}）`,
      'info');
    recordMonitorEvent('difficulty_assess', 'command', cmdAgent.name,
      `判定为${DIFFICULTY_LABEL[assessment.difficulty]}：${assessment.reason}`,
      { difficulty: assessment.difficulty, enableReview: assessment.enableReviewFramework });
    notify();

    // ========================================================
    // 简单档：跳过审查框架，直接开发交付
    // ========================================================
    if (assessment.difficulty === 'simple') {
      addLog(cmdAgent, 'command', '简单任务，跳过审查框架，直接进入开发', 'success');
      notify();

      // 直接提取 + 开发 + 部署
      addMessage('command', 'info', 'task', '请快速提取关键信息');
      await runStage('extract', `请快速提取以下需求的关键信息：\n\n${userInput}`);
      if (aborted()) return;

      addMessage('command', 'develop', 'task', '请直接实现');
      await runStage('develop', `请基于以下需求直接实现：\n\n${userInput}\n\n信息：${_state.stageOutputs.extract?.content || ''}`);
      if (aborted()) return;

      addMessage('command', 'develop', 'task', '请编写部署说明');
      await runStage('deploy', `请编写本任务的部署说明（部署步骤、所需环境与回滚方式，不要实际执行部署）。任务：${userInput}`);
      if (aborted()) return;

      // 终审
      await runStage('done', `请汇总交付：\n\n需求：${userInput}\n\n产出：${_state.stageOutputs.develop?.content || ''}`);
      addMessage('command', 'command', 'result', '任务交付完成（简单档快速通道）');
      return;
    }

    // ========================================================
    // 第二步：方案精炼（中等/复杂档）
    // ========================================================
    // P1-5: 注入 Skill Registry 供指挥 Agent 动态分配
    const allSkills = listSkills();
    const skillListStr = allSkills.map(s => `- ${s.id}: ${s.name} — ${s.description}`).join('\n');
    const initPrompt = `请针对以下需求制定协作方案，并为各角色 Agent 分配最适合的技能：\n\n需求：${userInput}\n\n可用技能列表：\n${skillListStr}\n\n请输出 JSON，包含 plan 字段和 agents 字段。agents 为数组，每项包含 role（与 Agent role 对应：leader/member/reviewer_logic/reviewer_fact/reviewer_user）和 assignedSkills（可用技能 id 数组）。`;
    const initOutput = await runStage('init', initPrompt);
    if (aborted()) return;
    {
      const { value: fullOutput, success } = safeJsonParse<Record<string, unknown>>(initOutput, {});
      if (success && fullOutput) {
        // 兼容两种输出结构：提示词要求的嵌套 { plan: {...}, agents: [...] }
        // 与模型自行输出的顶层 { summary, steps, ... }
        const planSrc = (fullOutput.plan || fullOutput) as Record<string, unknown>;
        const plan: Plan = {
          summary: String(planSrc.summary || ''),
          steps: (planSrc.steps as PipelineStage[]) || [],
          risks: (planSrc.risks as string[]) || [],
          suggestedApproach: String(planSrc.suggestedApproach || ''),
        };
        _state = { ..._state, plan };
        // P1-5: 解析 Agent Skill 动态分配
        if (fullOutput.agents && Array.isArray(fullOutput.agents)) {
          const assignments: Array<{ role: string; assignedSkills: string[] }> = fullOutput.agents
            .filter((x): x is { role: string; assignedSkills: string[] } => Boolean(x) && typeof (x as { role?: unknown }).role === 'string' && Array.isArray((x as { assignedSkills?: unknown }).assignedSkills));
          _state = {
            ..._state,
            agents: _state.agents.map(a => {
              const match = assignments.find(x => x.role === a.role);
              return match ? { ...a, assignedSkills: match.assignedSkills } : a;
            }),
          };
          addLog(pickAgent('command'), 'command',
            `指挥 Agent 已为 ${assignments.length} 个角色动态分配技能`, 'info');
        }
      } else {
        addLog(pickAgent('command'), 'command', '方案非标准 JSON，已降级为自由文本方案', 'warning');
      }
    }
    notify();

    // audit_entry —— 审查框架深度把关（方案级）
    // pass 才放行；conditional/reject → 重新制定并复审，最多 2 轮；仍未通过则暂停等人工
    addMessage('command', 'review', 'task', '方案待审查框架把关');
    let planAccepted = false;
    let currentPlanOutput = initOutput;
    for (let planAudit = 1; planAudit <= 2 && !planAccepted; planAudit++) {
      await executeReviewFramework(currentPlanOutput, 'plan', _abortController?.signal);
      if (aborted()) return;
      addMessage('review', 'command', 'result', `第 ${planAudit} 轮方案审查完成（${_state.reviewFramework?.totalRounds || 1} 轮）`);

      const verdict = _state.reviewFramework?.finalReport?.verdict;
      // demo 模式下审查框架必然降级（verdict 被强制 conditional），视为演示通过
      planAccepted = verdict === 'pass' || (_state.runMode === 'demo' && verdict === 'conditional');
      if (planAccepted || planAudit === 2) break;

      addLog(null, 'command', `方案审查未通过（${verdict === 'reject' ? '驳回' : '有条件通过'}），指挥部重新制定并送复审`, 'warning');
      notify();
      currentPlanOutput = await runStage('init',
        `审查框架驳回了上一版方案，请根据以下反馈重新制定：\n\n原始需求：${userInput}\n\n可用技能列表：\n${skillListStr}\n\n审查反馈：${formatReviewReport(_state.reviewFramework!.finalReport!)}`);
      if (aborted()) return;
      const { value: fullOutput, success: revisedOk } = safeJsonParse<Record<string, unknown>>(currentPlanOutput, {});
      if (revisedOk && fullOutput) {
        const planSrc = (fullOutput.plan || fullOutput) as Record<string, unknown>;
        const revisedPlan: Plan = {
          summary: String(planSrc.summary || ''),
          steps: (planSrc.steps as PipelineStage[]) || [],
          risks: (planSrc.risks as string[]) || [],
          suggestedApproach: String(planSrc.suggestedApproach || ''),
        };
        _state = { ..._state, plan: revisedPlan };
        if (fullOutput.agents && Array.isArray(fullOutput.agents)) {
          const assignments: Array<{ role: string; assignedSkills: string[] }> = fullOutput.agents
            .filter((x): x is { role: string; assignedSkills: string[] } => Boolean(x) && typeof (x as { role?: unknown }).role === 'string' && Array.isArray((x as { assignedSkills?: unknown }).assignedSkills));
          _state = {
            ..._state,
            agents: _state.agents.map(a => {
              const match = assignments.find(x => x.role === a.role);
              return match ? { ...a, assignedSkills: match.assignedSkills } : a;
            }),
          };
        }
      } else {
        addLog(pickAgent('command'), 'command', '修订方案非标准 JSON，已降级为自由文本方案', 'warning');
      }
      notify();
    }
    if (!planAccepted) {
      // 恢复 = 人工确认接受当前方案继续；放弃请停止任务
      addLog(null, 'command', '方案审查连续两轮未通过，自动暂停等待人工确认', 'error');
      _state = { ..._state, paused: true, pauseReason: 'plan-review' };
      notify();
      await waitIfPaused();
      if (aborted()) return;
      addLog(null, 'command', '人工确认后继续（方案审查未通过，风险自负）', 'warning');
      notify();
    }

    // ========================================================
    // P1-2 ConstitutionGuard: 检查 plan.steps 是否可驱动动态流水线
    // ========================================================
    const planSteps = _state.plan?.steps;
    const { valid: planValid } = planSteps && planSteps.length > 0
      ? validatePlan(planSteps)
      : { valid: false };

    if (planSteps && planSteps.length > 0 && planValid) {
      // ---- 动态路径：按 plan.steps 遍历执行 ----
      addLog(pickAgent('command'), 'command',
        `ConstitutionGuard 通过，按指挥部方案动态流水线执行（${planSteps.length} 阶段）`, 'success');
      recordMonitorEvent('plan_validation', 'command', 'ConstitutionGuard',
        `动态流水线启用：${planSteps.join(' → ')}`, { steps: planSteps });
      notify();

      let contentApproved = false;
      let codeApproved = false;
      let deepAuditPassed = false;
      for (const step of planSteps) {
        if (aborted()) return;
        if (step === 'difficulty_assess' || step === 'init' || step === 'audit_entry') continue;
        const ctx = buildPlanStepContext(userInput);

        if (step === 'done') {
          if (!contentApproved || !codeApproved) throw new Error('审核门禁未通过，禁止交付');
          const auditInfo = _state.reviewAuditCount > 0
            ? `\n\n【本次任务已经过 ${_state.reviewAuditCount} 轮审查框架审核】`
            : '';
          const stageSummary = Object.entries(_state.stageOutputs).map(([s, o]) => `[${s}] ${o.summary}`).join('\n');
          await runStage('done', `请汇总本次任务执行情况并交付：\n\n需求：${userInput}\n\n各阶段摘要：\n${stageSummary}${auditInfo}`);
        } else if (step === 'content_review') {
          if (!_state.stageOutputs.extract?.content) throw new Error('缺少待审核的信息提取结果');
          const output = await runStage('content_review', `请审核以下信息提取结果：\n\n${_state.stageOutputs.extract.content}\n\n【输出要求】先给出审核分析，最后一行输出 JSON 结论：{"result":"approved"或"rejected","issues":["问题"]}`);
          const result = gateReview('content_review', output);
          if (!result.approved) throw new Error(`内容审核未明确通过：${result.issues.join('；')}`);
          contentApproved = true;
        } else if (step === 'code_review') {
          if (!_state.stageOutputs.develop?.content) throw new Error('缺少待审核的开发产出');
          const output = await runStage('code_review', `请审核以下开发产出：\n\n${_state.stageOutputs.develop.content}\n\n【输出要求】先给出审核分析，最后一行输出 JSON 结论：{"result":"approved"或"rejected","issues":["问题"]}`);
          const result = gateReview('code_review', output);
          if (!result.approved) throw new Error(`代码审核未明确通过：${result.issues.join('；')}`);
          codeApproved = true;
        } else if (step === 'deep_audit') {
          const code = _state.stageOutputs.develop?.content || '';
          if (!codeApproved || !code) throw new Error('深度审计前代码审核尚未通过');
          await executeReviewFramework(code, 'code', _abortController?.signal);
          if (_state.reviewFramework?.finalReport?.verdict !== 'pass') {
            throw new Error('深度审计未明确通过，禁止进入部署');
          }
          deepAuditPassed = true;
        } else if (step === 'deploy') {
          if (!contentApproved || !codeApproved) throw new Error('审核门禁未通过，禁止部署');
          if (_state.difficulty === 'complex' && !deepAuditPassed) {
            throw new Error('复杂任务必须通过深度审计后才能部署');
          }
          // 未接入部署执行器：本阶段仅产出部署说明存档，不判定"已部署"
          await runStage('deploy', `请编写本任务的部署说明（部署步骤、所需环境与回滚方式，不要实际执行部署）。任务：${userInput}\n\n上下文：\n${ctx}`);
          if (_state.stageOutputs.deploy?.source === 'live') {
            addLog(pickAgent('develop'), 'develop', '部署执行器未接入，以上产出仅为部署说明，不视为已部署', 'warning');
            recordMonitorEvent('framework_phase', 'develop', pickAgent('develop').name, '部署执行器未接入，仅生成部署说明');
          }
          notify();
        } else {
          await runStage(step, ctx);
        }
      }
      addMessage('command', 'command', 'result', `动态流水线交付完成（${_state.reviewAuditCount} 轮审查框架审核）`);
    } else {
      // ---- 兜底路径：走原有 difficulty 硬编码分支 ----
      if (planSteps && planSteps.length > 0 && !planValid) {
        addLog(pickAgent('command'), 'command', 'Plan.steps 校验未通过，回退硬编码路径', 'warning');
      }

      // ========================================================
      // 第三步：三部门协同
      // ========================================================
      // extract —— 信息部提取（带内容审核打回循环）
      let contentApproved = false;
      let extractAttempts = 0;
      while (!contentApproved && extractAttempts < 3) {
        if (aborted()) return;
        extractAttempts++;
        addMessage('command', 'info', 'task', '请提取关键信息');
        const extractOutput = await runStage('extract',
          `请从以下需求与方案中提取关键信息（标注信息来源和可信度）：\n\n需求：${userInput}\n\n方案：${initOutput}`);
        if (aborted()) return;

        addMessage('info', 'review', 'result', '信息提取完成，待内容审核');
        const reviewOutput = await runStage('content_review', `请审核以下信息提取结果的准确性：\n\n${extractOutput}\n\n【输出要求】先给出审核分析，最后一行输出 JSON 结论：{"result":"approved"或"rejected","issues":["问题"]}`);
        if (aborted()) return;

        const { approved, issues } = gateReview('content_review', reviewOutput);
        if (approved) {
          contentApproved = true;
          addMessage('review', 'info', 'ack', '内容审核通过');
        } else {
          _state = { ..._state, contentRejectCount: _state.contentRejectCount + 1 };
          addMessage('review', 'info', 'review', `内容审核打回：${issues.join('；')}`);
          addLog(pickAgent('review'), 'review', `内容审核第 ${extractAttempts} 次打回`, 'warning');
          notify();
          if (_state.contentRejectCount >= 3) {
            if (_state.difficulty === 'complex') {
              addLog(null, 'review', '内容审核打回超 3 次（复杂档），触发审查框架深度复审', 'warning');
              notify();
              await executeReviewFramework(extractOutput, 'plan', _abortController?.signal);
              if (aborted()) return;
            }
            addLog(pickAgent('command'), 'command', '内容审核打回超过 3 次，自动暂停', 'error');
            _state = { ..._state, paused: true, pauseReason: 'retry-limit' };
            notify();
            await waitIfPaused();
            if (aborted()) return;
            // 恢复 = 重试审核循环（重新计数）；放弃请点「停止」
            extractAttempts = 0;
            _state = { ..._state, contentRejectCount: 0 };
            notify();
          }
        }
      }

      // ========================================================
      // 第四步：双重审计防线
      // ========================================================
      let codeApproved = false;
      let devAttempts = 0;
      while (!codeApproved && devAttempts < 3) {
        if (aborted()) return;
        devAttempts++;
        addMessage('command', 'develop', 'task', '请编码实现');
        const devOutput = await runStage('develop',
          `请基于以下信息编码实现：\n\n需求：${userInput}\n\n信息：${_state.stageOutputs.extract?.content || ''}`);
        if (aborted()) return;

        addMessage('develop', 'review', 'result', '编码完成，待代码审核');
        const codeReviewOutput = await runStage('code_review', `请审核以下代码：\n\n${devOutput}\n\n【输出要求】先给出审核分析，最后一行输出 JSON 结论：{"result":"approved"或"rejected","issues":["问题"]}`);
        if (aborted()) return;

        const { approved, issues } = gateReview('code_review', codeReviewOutput);
        if (approved) {
          codeApproved = true;
          addMessage('review', 'develop', 'ack', '代码审核通过');

          if (_state.difficulty === 'complex') {
            addLog(null, 'review', '复杂档：启动系统级深度审计（第二道防线）', 'info');
            notify();
            await executeReviewFramework(devOutput, 'code', _abortController?.signal);
            if (aborted()) return;

            if (_state.reviewFramework?.finalReport?.verdict !== 'pass') {
              codeApproved = false;
              addLog(null, 'review', '系统级深度审计未通过或结果不确定，打回开发部', 'warning');
              _state = { ..._state, codeRejectCount: _state.codeRejectCount + 1 };
              notify();
            } else {
              addLog(null, 'review', '系统级深度审计明确通过', 'success');
            }
          }
        } else {
          _state = { ..._state, codeRejectCount: _state.codeRejectCount + 1 };
          addMessage('review', 'develop', 'review', `代码审核打回：${issues.join('；')}`);
          addLog(pickAgent('review'), 'review', `代码审核第 ${devAttempts} 次打回`, 'warning');
          notify();
          if (_state.codeRejectCount >= 3) {
            addLog(pickAgent('command'), 'command', '代码审核打回超过 3 次，自动暂停', 'error');
            _state = { ..._state, paused: true, pauseReason: 'retry-limit' };
            notify();
            await waitIfPaused();
            if (aborted()) return;
            // 恢复 = 重试审核循环（重新计数）；放弃请点「停止」
            devAttempts = 0;
            _state = { ..._state, codeRejectCount: 0 };
            notify();
          }
        }
      }

      // 修复：兜底路径循环结束后必须检查门禁，未通过不得交付
      if (!codeApproved) {
        addLog(pickAgent('command'), 'command', '深度审计连续未通过，自动暂停，等待人工决策', 'error');
        _state = { ..._state, paused: true, pauseReason: 'retry-limit' };
        notify();
        await waitIfPaused();
        if (aborted()) return;
        addLog(pickAgent('command'), 'command', '人工确认继续（风险由操作者承担），重新进入交付', 'warning');
        _state = { ..._state, codeRejectCount: 0 };
        notify();
      }

      // ========================================================
      // 第五步：终审与交付
      // ========================================================
      if (aborted()) return;
      addMessage('command', 'develop', 'task', '请编写部署说明');
      // 未接入部署执行器：本阶段仅产出部署说明存档，不判定"已部署"
      await runStage('deploy', `请编写本任务的部署说明（部署步骤、所需环境与回滚方式，不要实际执行部署）。任务：${userInput}\n\n代码：${_state.stageOutputs.develop?.content || ''}`);
      if (_state.stageOutputs.deploy?.source === 'live') {
        addLog(pickAgent('develop'), 'develop', '部署执行器未接入，以上产出仅为部署说明，不视为已部署', 'warning');
        recordMonitorEvent('framework_phase', 'develop', pickAgent('develop').name, '部署执行器未接入，仅生成部署说明');
      }
      addMessage('develop', 'command', 'result', '部署说明已生成（未接入部署执行器，不视为已部署）');
      notify();

      // done
      if (aborted()) return;
      const auditInfo = _state.reviewAuditCount > 0
        ? `\n\n【本次任务已经过 ${_state.reviewAuditCount} 轮审查框架审核】`
        : '';
      const stageSummary = Object.entries(_state.stageOutputs)
        .map(([s, o]) => `[${s}] ${o.summary}`)
        .join('\n');
      const summaryPrompt = `请汇总本次任务执行情况并交付：\n\n需求：${userInput}\n\n各阶段摘要：\n${stageSummary}${auditInfo}`;
      await runStage('done', summaryPrompt);
      addMessage('command', 'command', 'result', `任务交付完成（${_state.reviewAuditCount} 轮审查框架审核）`);
    }

  } catch (err: unknown) {
    // 用户主动停止：静默收尾，不算异常
    if ((err as { name?: string })?.name === 'AbortError') {
      _state = { ..._state, log: [..._state.log, {
        time: new Date().toISOString(), agentId: '', department: 'command',
        message: '任务已被用户停止', type: 'warning',
      }] };
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      _state = {
        ..._state,
        errors: [..._state.errors, msg],
        log: [..._state.log, {
          time: new Date().toISOString(), agentId: '', department: 'command',
          message: `流水线异常：${msg}`, type: 'error',
        }],
      };
    }
  } finally {
    _state = { ..._state, isRunning: false };
    _abortController = null;
    _pausedResolve = null;
    notify();
  }
}


// ============================================================
// v3 引擎：能力注册表 + 动态任务图 + 策略化审查 + AgentRouter（默认执行器）
//
// v3.1 变更：
//   - 所有能力调用统一走 invokeLLM（plan/extract/research/draft/deliver/review 同一套预算/审计/失败语义）
//   - 选人统一走 AgentRouter（队长规划/汇总、成员执行、跨部门代办留痕）
//   - 节点级输出 nodeOutputs 为业务事实源；stageOutputs 仅保留给旧 UI 兼容
//   - 失败传播、onFail=abort、预算超限均中止任务（不再静默继续）
// ============================================================
export type EngineMode = 'legacy' | 'v3';

let _engineMode: EngineMode = 'v3';
let _v3Budget: InvokeBudget = createBudget(240, 40);
const _nodeAttempts = new Map<string, number>();

export function setEngineMode(mode: EngineMode): void { _engineMode = mode; }
export function getEngineMode(): EngineMode { return _engineMode; }

function capabilityDepartment(node: NodeSpec): Department {
  return DEPARTMENT_BY_CAPABILITY[node.capability];
}

/** v3 能力/节点 → 旧阶段（只用于 UI 兼容与进度显示） */
function legacyStageForNode(node: NodeSpec): PipelineStage | null {
  switch (node.capability) {
    case 'plan': return 'init';
    case 'extract': return 'extract';
    case 'research': return null;       // 不覆盖 extract 的旧阶段产出
    case 'draft': return 'develop';
    case 'deliver': return 'done';
    case 'review': return mapStageForReview(node);
    case 'verify': return null;
    default: return null;
  }
}

function mapStageForReview(node: NodeSpec): PipelineStage {
  const kind = String(node.params?.kind || '');
  if (kind === 'plan') return 'audit_entry';
  if (kind === 'content') return 'content_review';
  if (kind === 'code') return 'code_review';
  if (kind === 'security' || kind === 'deep') return 'deep_audit';
  return 'audit_entry';
}

function summarizeOutput(content: string, fallback: string): string {
  const firstLine = content.split('\n').map(l => l.trim()).find(Boolean);
  return (firstLine || fallback).slice(0, 80);
}

/** 保存节点级产出，并写一份旧 stageOutputs 兼容视图（旧 UI 只读 stageOutputs） */
function saveNodeOutput(node: NodeSpec, result: NodeResult): void {
  // 确定性节点（verify）与演示审查没有真实调用，也需要可追溯的本地审计 ID，
  // 保证每个节点都能在事件流/回放里被定位（local_* 表示无外呼的本地判定）。
  const auditIds = result.auditIds && result.auditIds.length > 0
    ? result.auditIds
    : [`local_${Date.now().toString(36)}_${node.id}_${Math.random().toString(36).slice(2, 8)}`];
  const out: NodeOutput = {
    nodeId: node.id,
    capability: node.capability,
    title: node.title,
    status: result.status,
    content: result.output,
    summary: summarizeOutput(result.output, node.title),
    auditIds,
    gate: result.gate,
    agentId: result.agentId,
    provider: result.provider,
    model: result.model,
    attempt: result.attempt || 1,
    createdAt: new Date().toISOString(),
    contextInfo: result.contextInfo,
  };
  _state = { ..._state, nodeOutputs: { ..._state.nodeOutputs, [node.id]: out } };

  const legacyStage = legacyStageForNode(node);
  if (legacyStage) {
    const dept = STAGE_DEPT[legacyStage];
    const agent = _state.agents.find(a => a.id === result.agentId) || pickAgent(dept);
    saveStageOutput(legacyStage, agent, result.output, out.summary, 'done', result.elapsedMs,
      result.status === 'demo' ? 'demo' : 'live');
  }

  if (result.contextInfo?.truncated?.length) {
    recordMonitorEvent('context_truncated', capabilityDepartment(node), node.title,
      `上下文截断：${result.contextInfo.truncated.length} 个来源被裁剪（原始 ${result.contextInfo.usedChars} 字符 / 约 ${result.contextInfo.estimatedTokens} tokens）`,
      { nodeId: node.id, truncated: result.contextInfo.truncated, estimatedTokens: result.contextInfo.estimatedTokens });
    addLog(null, 'command',
      `[上下文预算] ${node.title}：约 ${result.contextInfo.estimatedTokens} tokens，截断 ${result.contextInfo.truncated.length} 个来源`,
      'warning');
  }
  recordMonitorEvent('node_output', capabilityDepartment(node), node.title,
    `${node.title} 完成（${result.status}${result.gate ? ' · ' + result.gate.verdict : ''}）`, {
      nodeId: node.id,
      capability: node.capability,
      status: result.status,
      auditIds: out.auditIds,
      gate: result.gate ? { verdict: result.gate.verdict, degraded: result.gate.degraded } : undefined,
      attempt: out.attempt,
    });
  notify();
}

/** 记录 Agent 一次执行结果：Router EMA + UI 统计（任务完成/失败/平均耗时） */
function recordAgentOutcome(agentId: string, ok: boolean, elapsedMs: number): void {
  agentRouter.recordOutcome(agentId, ok, elapsedMs);
  _state = {
    ..._state,
    agents: _state.agents.map(agent => {
      if (agent.id !== agentId) return agent;
      const total = agent.stats.tasksCompleted + agent.stats.errors;
      const nextAvg = total > 0
        ? (agent.stats.avgTime * total + elapsedMs) / (total + 1)
        : elapsedMs;
      return {
        ...agent,
        stats: {
          tasksCompleted: agent.stats.tasksCompleted + (ok ? 1 : 0),
          errors: agent.stats.errors + (ok ? 0 : 1),
          avgTime: Math.round(nextAvg),
        },
      };
    }),
  };
  notify();
}

export interface PreflightIssue {
  capability: CapabilityId;
  department: Department;
  reason: string;
}

export interface PreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
  matrix: Array<{ capability: CapabilityId; department: Department; available: string[] }>;
}

/**
 * live 模式启动前预检（v3.2）：
 * 生成「能力 → 部门 → 可用 Agent」矩阵，检查：
 *   1) 该部门是否有已配置 Key 的 Agent；
 *   2) Agent 使用的模型是否已注册；
 *   3) 模型 provider 是否有主进程端点（已知且受支持）。
 * 任一能力缺可用执行者 → 预检失败（fail-closed，由调用方决定禁止启动）。
 */
export function preflightLiveMode(agents: Agent[], models: ModelConfig[]): PreflightResult {
  const issues: PreflightIssue[] = [];
  const matrix: PreflightResult['matrix'] = [];
  const capabilities = Object.keys(DEPARTMENT_BY_CAPABILITY) as CapabilityId[];
  const providerOf = (modelId: string): string | undefined =>
    models.find(m => m.id === modelId)?.provider;

  for (const capability of capabilities) {
    const department = DEPARTMENT_BY_CAPABILITY[capability];
    const deptAgents = agents.filter(a => a.department === department);
    const available: string[] = [];

    for (const agent of deptAgents) {
      if (!agent.hasKey) continue;
      const provider = providerOf(agent.model);
      if (!provider) {
        issues.push({ capability, department, reason: `${agent.id} 的模型「${agent.model}」未在模型注册表中` });
        continue;
      }
      if (!isProviderKnown(provider)) {
        issues.push({ capability, department, reason: `${agent.id} 的 provider「${provider}」未知（主进程会拒绝）` });
        continue;
      }
      if (!isProviderSupported(provider)) {
        issues.push({ capability, department, reason: `${agent.id} 的 provider「${provider}」无默认端点（请改用受支持厂商）` });
        continue;
      }
      available.push(agent.id);
    }

    if (available.length === 0) {
      issues.push({ capability, department, reason: `部门「${department}」没有可用的已配置 Key 执行者` });
    }
    matrix.push({ capability, department, available });
  }

  return { ok: issues.length === 0, issues, matrix };
}

/**
 * 统一能力调用：路由 → 预算 → invokeLLM → 失败暂停重试 → 记录调用信息。
 * 所有非验证类能力（plan/extract/research/draft/deliver）都走这里。
 */
interface CapabilityCallResult {
  content: string;
  status: 'live' | 'demo';
  auditIds: string[];
  agentId: string;
  provider: string;
  model: string;
  attempt: number;
}

async function runCapabilityInvoke(node: NodeSpec, prompt: string, feedback?: string): Promise<CapabilityCallResult> {
  const legacyStage = legacyStageForNode(node);
  if (legacyStage) setStage(legacyStage);

  const routeRequest = {
    department: capabilityDepartment(node),
    capability: node.capability,
    agents: _state.agents,
    runMode: _state.runMode,
  } as const;

  let route = agentRouter.route(routeRequest);
  const triedAgents = new Set<string>();
  const userPrompt = feedback ? `${prompt}\n\n【返工要求】\n${feedback}` : prompt;
  let crossLogged = false;

  for (;;) {
    if (aborted()) throw new DOMException('Aborted', 'AbortError');
    const agent = route.agent;

    if (route.crossDepartment && !crossLogged) {
      crossLogged = true;
      addLog(null, 'command',
        `跨部门代办：${node.title} 由「${agent.department} / ${agent.name}」执行（本部门无可用 Key）`, 'warning');
      recordMonitorEvent('agent_route', agent.department, agent.name,
        `跨部门代办：${node.title}`, { crossDepartment: true, nodeId: node.id, candidates: route.candidates });
    }

    setAgentStatus(agent.id, 'running', node.title);
    addLog(agent, agent.department, `执行「${node.title}」${feedback ? '（返工）' : ''}`, 'info');
    notify();

    const attempt = (_nodeAttempts.get(node.id) || 0) + 1;
    _nodeAttempts.set(node.id, attempt);
    const callStarted = Date.now();

    agentRouter.begin(agent.id);
    let out;
    try {
      out = await invokeLLM({
        context: { taskId: _state.taskId, nodeId: node.id, capability: node.capability, attempt },
        agent,
        models: _state.models,
        stage: node.capability,
        systemPrompt: agent.systemPrompt,
        userPrompt,
        demo: _state.runMode === 'demo',
        signal: _abortController?.signal,
        budget: _v3Budget,
        retry: { max: 1 },
      });
    } finally {
      agentRouter.end(agent.id);
    }

    if (out.status === 'failed') {
      const code = out.error?.code || 'unknown';
      recordAgentOutcome(agent.id, false, Date.now() - callStarted);
      setAgentStatus(agent.id, 'error', node.title);
      addLog(agent, agent.department,
        `「${node.title}」调用失败：${out.error?.message || '未知错误'}（${code}）`, 'error');
      recordMonitorEvent('api_failure', agent.department, agent.name,
        `「${node.title}」调用失败：${out.error?.message || '未知错误'}`, {
          nodeId: node.id, code, auditId: out.auditId, retryCount: out.retryCount, agentId: agent.id,
        });

      // 预算超限属于“任务级中止”，不是等待重试
      if (code === 'budget-exceeded' || code === 'budget-node-exceeded') {
        recordMonitorEvent('budget', 'command', '预算控制',
          `预算超限，任务中止：${out.error?.message}`, { nodeId: node.id, code });
        throw new Error(`预算超限，任务中止：${out.error?.message}`);
      }

      triedAgents.add(agent.id);
      // 故障梯度：可重试错误 → 同部门备用 Agent →（Router 允许时）跨部门 → 人工
      const canRotate = Boolean(out.error?.retryable) && triedAgents.size < 3;
      if (canRotate) {
        try {
          const nextRoute = agentRouter.route({ ...routeRequest, excludeAgentIds: [...triedAgents] });
          addLog(null, 'command',
            `故障切换：${node.title} 由「${agent.name}」切换到「${nextRoute.agent.department} / ${nextRoute.agent.name}」`, 'warning');
          recordMonitorEvent('agent_route', nextRoute.agent.department, nextRoute.agent.name,
            `故障切换：${node.title}`, {
              nodeId: node.id, from: agent.id, to: nextRoute.agent.id, code,
              crossDepartment: nextRoute.crossDepartment,
            });
          route = nextRoute;
          continue;
        } catch {
          // 无可用备选 → 进入人工兜底
        }
      }

      _state = { ..._state, paused: true, pauseReason: 'api-retry' };
      notify();
      await waitIfPaused();
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      setAgentStatus(agent.id, 'running', node.title);
      addLog(agent, agent.department, `重试「${node.title}」`, 'info');
      notify();
      continue;
    }

    recordAgentOutcome(agent.id, true, Date.now() - callStarted);
    setAgentStatus(agent.id, 'done');
    addLog(agent, agent.department,
      `「${node.title}」完成（${Date.now() - callStarted}ms · ${out.status}）`, 'success');
    return {
      content: out.content,
      status: out.status,
      auditIds: out.auditIds,
      agentId: agent.id,
      provider: out.provider,
      model: out.model,
      attempt,
    };
  }
}

async function runDifficultyAssessmentV3(userInput: string): Promise<Difficulty | null> {
  setStage('difficulty_assess');
  const route = agentRouter.route({
    department: 'command',
    capability: 'plan',
    agents: _state.agents,
    runMode: _state.runMode,
    preferredRoles: ['leader', 'member'],
  });
  const cmdAgent = route.agent;
  if (route.crossDepartment) {
    recordMonitorEvent('agent_route', cmdAgent.department, cmdAgent.name,
      '难度评估跨部门代办（指挥部无可用 Key）', { crossDepartment: true, candidates: route.candidates });
  }
  setAgentStatus(cmdAgent.id, 'running', '难度评估');
  addLog(cmdAgent, 'command', '指挥部启动难度评估', 'info');
  notify();

  const assessment = await assessDifficulty(userInput, cmdAgent, _state.models, _abortController?.signal, {
    demo: _state.runMode === 'demo',
    budget: _v3Budget,
    taskId: _state.taskId,
  });
  if (aborted()) return null;

  if (assessment.degraded) {
    addLog(cmdAgent, 'command', '难度评估降级：调用失败，已使用关键词兜底（审核强度不低于中等档）', 'warning');
    recordMonitorEvent('difficulty_assess', 'command', cmdAgent.name,
      '难度评估降级：使用关键词兜底', { degraded: true, difficulty: assessment.difficulty });
  }
  _state.difficultyDegraded = !!assessment.degraded;

  // demo 模式下深度审计无法真实通过；复杂档统一按中等档演示，避免“演示必卡死”
  if (_state.runMode === 'demo' && assessment.difficulty === 'complex') {
    _state.difficulty = 'medium';
    _state.difficultyReason = `${assessment.reason}（演示模式：复杂档按中等档执行）`;
    addLog(cmdAgent, 'command', '演示模式下复杂任务按中等档执行（深度审计需要真实模型）', 'warning');
  } else {
    _state.difficulty = assessment.difficulty;
    _state.difficultyReason = assessment.reason;
  }

  setAgentStatus(cmdAgent.id, 'done');
  addLog(cmdAgent, 'command',
    `难度评估：${DIFFICULTY_LABEL[_state.difficulty!]}（${_state.difficultyReason}）`, 'info');
  recordMonitorEvent('difficulty_assess', 'command', cmdAgent.name,
    `判定为${DIFFICULTY_LABEL[_state.difficulty!]}：${_state.difficultyReason}`,
    { difficulty: _state.difficulty, mode: _engineMode });
  notify();
  return _state.difficulty;
}

/** 按节点能力与上游产出装配受预算约束的上下文（替代无边界拼接） */
function buildNodeContext(node: NodeSpec, inputs: string[]): ContextBuildResult {
  const sources: ContextSource[] = [
    { id: 'user', label: '用户目标', content: _state.userInput, priority: 100 },
  ];

  node.inputs.forEach((input, idx) => {
    if (input.from === 'user') return;
    const out = _state.nodeOutputs[input.from];
    const content = inputs[idx] || out?.content || '';
    if (!content) return;
    const passed = out?.gate?.verdict === 'pass';
    sources.push({
      id: input.from,
      label: out?.title || input.from,
      content,
      priority: passed ? 60 : 30,
    });
  });

  // 交付节点：额外纳入所有已过门禁节点的摘要（低优先级，受预算约束）
  if (node.capability === 'deliver') {
    for (const out of Object.values(_state.nodeOutputs)) {
      if (out.status === 'failed') continue;
      if (sources.some(src => src.id === out.nodeId)) continue;
      sources.push({
        id: out.nodeId,
        label: `${out.title}（摘要）`,
        content: out.summary,
        priority: out.gate?.verdict === 'pass' ? 45 : 25,
      });
    }
  }

  return buildContext(sources, {
    tokenBudget: CAPABILITY_META[node.capability].contextTokens,
    maxSingleShare: 0.65,
  });
}

function toContextInfo(ctx: ContextBuildResult): NodeResult['contextInfo'] {
  return { estimatedTokens: ctx.estimatedTokens, usedChars: ctx.usedChars, truncated: ctx.truncated };
}

async function executeV3Node(node: NodeSpec, inputs: string[], feedback?: string, attempt = 1): Promise<NodeResult> {
  const started = Date.now();
  const ctx = buildNodeContext(node, inputs);
  const contextInfo = toContextInfo(ctx);
  const feedbackBlock = feedback ? `\n\n【返工要求】\n${feedback}` : '';

  switch (node.capability) {
    case 'plan': {
      const call = await runCapabilityInvoke(node,
        `请针对以下需求制定协作方案，说明目标拆解、关键步骤、风险与验收标准：\n\n${ctx.text}${feedbackBlock}`);
      const firstLine = call.content.split('\n').map(l => l.trim()).find(Boolean) || '方案已生成';
      _state = {
        ..._state,
        plan: { summary: firstLine.slice(0, 120), steps: [], risks: [], suggestedApproach: '' },
      };
      return {
        status: call.status, output: call.content, elapsedMs: Date.now() - started,
        auditIds: call.auditIds, agentId: call.agentId, provider: call.provider, model: call.model, attempt, contextInfo,
      };
    }
    case 'extract': {
      const call = await runCapabilityInvoke(node,
        `请从以下材料中提取关键信息（标注来源和可信度，区分事实与推断）：\n\n${ctx.text}${feedbackBlock}`);
      return {
        status: call.status, output: call.content, elapsedMs: Date.now() - started,
        auditIds: call.auditIds, agentId: call.agentId, provider: call.provider, model: call.model, attempt, contextInfo,
      };
    }
    case 'research': {
      const call = await runCapabilityInvoke(node,
        `请围绕以下任务整理关键事实与参考资料（标注来源/时效/可信度，并给出可引用的证据卡）：\n\n${ctx.text}${feedbackBlock}`);
      return {
        status: call.status, output: call.content, elapsedMs: Date.now() - started,
        auditIds: call.auditIds, agentId: call.agentId, provider: call.provider, model: call.model, attempt, contextInfo,
      };
    }
    case 'draft': {
      const call = await runCapabilityInvoke(node,
        `请基于以下上下文完成实现（给出完整、可执行的产出；涉及代码请给出代码与验证方法）：\n\n${ctx.text}${feedbackBlock}`);
      return {
        status: call.status, output: call.content, elapsedMs: Date.now() - started,
        auditIds: call.auditIds, agentId: call.agentId, provider: call.provider, model: call.model, attempt, contextInfo,
      };
    }
    case 'deliver': {
      const call = await runCapabilityInvoke(node,
        `请汇总本次任务执行情况并交付（列出产物、门禁结论、未解决风险与人工介入点）：\n\n${ctx.text}\n\n已执行审查轮次：${_state.reviewAuditCount}\n调用预算：${_v3Budget.taskCalls}/${_v3Budget.maxTaskCalls}`);
      return {
        status: call.status, output: call.content, elapsedMs: Date.now() - started,
        auditIds: call.auditIds, agentId: call.agentId, provider: call.provider, model: call.model, attempt, contextInfo,
      };
    }
    case 'verify':
      return executeV3VerifyNode(node, inputs);
    default:
      return { status: 'failed', output: '', elapsedMs: 0, auditIds: [], error: `未知能力：${String(node.capability)}` };
  }
}

async function executeV3ReviewNode(node: NodeSpec, inputs: string[], feedback?: string, attempt = 1): Promise<NodeResult> {
  const started = Date.now();
  const stage = mapStageForReview(node);
  const policyId = String(node.params?.policy || 'standard');
  const targetLabel = String(node.params?.targetLabel || node.title);
  const content = inputs[0] || '';
  const targetContent = feedback ? `${content}\n\n【上轮审查反馈】\n${feedback}` : content;

  setStage(stage);
  addLog(null, 'review', `启动审查「${node.title}」（策略 ${policyId}${feedback ? ' · 返工复审' : ''}）`, 'info');
  notify();

  const outcome = await runReview({
    targetLabel,
    targetContent,
    policyId,
    agents: _state.agents,
    models: _state.models,
    demo: _state.runMode === 'demo',
    signal: _abortController?.signal,
    budget: _v3Budget,
    context: { taskId: _state.taskId, nodeId: node.id },
    onProgress: (phase, detail) => {
      addLog(null, 'review', `[审查] ${phase}${detail ? ' · ' + detail : ''}`, 'info');
      notify();
    },
  });

  // 跨部门审查员代办留痕
  for (const route of outcome.routes) {
    if (route.crossDepartment) {
      recordMonitorEvent('agent_route', route.agent.department, route.agent.name,
        `审查员跨部门代办：${node.title}`, { crossDepartment: true, nodeId: node.id, candidates: route.candidates });
    }
  }

  const verdictLabel = { pass: '✅ 通过', conditional: '⚠️ 有条件通过', reject: '❌ 驳回' }[outcome.gate.verdict];
  addLog(null, 'review', `审查完成：${verdictLabel}（${outcome.gate.policyId} · ${outcome.gate.rounds} 轮 · ${Date.now() - started}ms）`,
    outcome.gate.verdict === 'reject' ? 'warning' : 'success');
  recordMonitorEvent('review_opinion', 'review', '审查服务',
    `「${node.title}」最终裁决：${verdictLabel}`, {
      policyId: outcome.gate.policyId,
      verdict: outcome.gate.verdict,
      rounds: outcome.gate.rounds,
      degraded: outcome.gate.degraded,
      auditIds: outcome.auditIds,
    });
  _state.reviewAuditCount += 1;

  // 兼容旧 ReviewDetail：填充简化审查状态
  _state.reviewFramework = {
    phase: 'done',
    triggerPoint: String(node.params?.kind || '') === 'plan' ? 'plan' : 'code',
    depth: outcome.gate.policyId === 'panel' ? 'full' : 'single',
    difficulty: _state.difficulty || 'medium',
    extraction: null,
    extraction2: null,
    roundJudge: null,
    totalRounds: outcome.gate.rounds,
    rounds: [],
    finalReport: {
      pros: [],
      issues: outcome.gate.findings.map(f => ({ severity: f.severity, desc: f.desc })),
      suggestions: [],
      verdict: outcome.gate.verdict,
      degraded: outcome.gate.degraded,
      totalRounds: outcome.gate.rounds,
      totalElapsedMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    },
    isRunning: false,
    elapsedMs: Date.now() - started,
  };
  notify();

  const reviewerRoute = outcome.routes[0];
  return {
    status: outcome.gate.degraded ? 'demo' : 'live',
    output: outcome.reportText,
    elapsedMs: Date.now() - started,
    gate: outcome.gate,
    auditIds: outcome.auditIds,
    agentId: reviewerRoute?.agent.id,
    provider: reviewerRoute ? _state.models.find(m => m.id === reviewerRoute.agent.model)?.provider : undefined,
    model: reviewerRoute?.agent.model,
    attempt,
  };
}

async function executeV3VerifyNode(node: NodeSpec, inputs: string[]): Promise<NodeResult> {
  const started = Date.now();
  const content = inputs[0] || '';
  const rawChecks = Array.isArray(node.params?.checks) ? (node.params.checks as string[]) : ['nonempty'];
  const expectedKeys = Array.isArray(node.params?.expectedKeys)
    ? (node.params.expectedKeys as string[])
    : undefined;

  // demo 模式只做非空检查（演示数据不可能满足真实结构化/来源校验）
  const checks = _state.runMode === 'demo' ? ['nonempty'] : rawChecks;

  // 来源校验以节点级产出为准（最近一次 draft）
  const draftOutput = Object.values(_state.nodeOutputs)
    .filter(o => o.capability === 'draft')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .pop();
  const liveSourceOk = _state.runMode === 'demo'
    ? true
    : draftOutput?.status !== 'demo';

  const outcome = evaluateVerify({ checks, content, liveSourceOk, expectedKeys });
  const findings: GateResult['findings'] = outcome.results
    .filter(r => !r.ok)
    .map(r => ({
      severity: (r.kind === 'live-source' ? 'high' : 'medium') as 'high' | 'medium',
      category: 'quality' as const,
      desc: r.reason || `校验未通过：${r.kind}`,
    }));

  const pass = outcome.ok;
  const gate: GateResult = {
    verdict: pass ? 'pass' : 'reject',
    findings,
    degraded: _state.runMode === 'demo',
    rounds: 1,
    policyId: 'verify',
  };
  addLog(null, 'review', `确定性校验（${checks.join('/')}）：${pass ? '通过' : `未通过（${findings.length} 项）`}`,
    pass ? 'success' : 'warning');
  recordMonitorEvent('review_opinion', 'review', '确定性校验',
    pass ? '校验通过' : findings.map(f => f.desc).join('；'),
    { checks, pass, nodeId: node.id, results: outcome.results });
  notify();
  return {
    status: _state.runMode === 'demo' ? 'demo' : 'live',
    output: pass ? `确定性校验通过（${checks.join('/')}）` : findings.map(f => `[${f.severity}] ${f.desc}`).join('；'),
    elapsedMs: Date.now() - started,
    gate,
    auditIds: [],
    attempt: 1,
  };
}

function incrementV3Counter(key?: 'contentRejectCount' | 'codeRejectCount'): number {
  if (key === 'contentRejectCount') {
    _state = { ..._state, contentRejectCount: _state.contentRejectCount + 1 };
    notify();
    return _state.contentRejectCount;
  }
  if (key === 'codeRejectCount') {
    _state = { ..._state, codeRejectCount: _state.codeRejectCount + 1 };
    notify();
    return _state.codeRejectCount;
  }
  return 0;
}

async function handleV3GateFailure(node: NodeSpec, result: NodeResult): Promise<'accept' | 'abort'> {
  const verdict = result.gate?.verdict || 'reject';

  // 演示模式：门禁不通过只记录，不阻断演示流程；产出始终标记 demo，绝不会计入真实通过
  if (_state.runMode === 'demo') {
    addLog(null, 'review', `演示模式：${node.title} ${verdict === 'conditional' ? '有条件通过' : '未通过'}，按演示流程继续（不计真实通过）`, 'warning');
    recordMonitorEvent('review_opinion', 'review', '审查服务',
      `演示模式门禁放行：${node.title}（${verdict}）`, { demo: true, verdict });
    return 'accept';
  }

  if (verdict === 'conditional') {
    addLog(null, 'review', `${node.title} 有条件通过，自动暂停等待人工确认`, 'warning');
    _state = { ..._state, paused: true, pauseReason: 'plan-review' };
    notify();
    await waitIfPaused();
    if (aborted()) throw new DOMException('Aborted', 'AbortError');
    addLog(null, 'command', `人工确认继续（${node.title} 有条件通过，风险由操作者承担）`, 'warning');
    notify();
    return 'accept';
  }

  addLog(null, 'review', `${node.title} 未通过，自动暂停等待人工决策`, 'error');
  _state = { ..._state, paused: true, pauseReason: 'plan-review' };
  notify();
  await waitIfPaused();
  if (aborted()) throw new DOMException('Aborted', 'AbortError');
  addLog(null, 'command', `人工确认继续（${node.title} 未通过，风险由操作者承担）`, 'warning');
  notify();
  return 'accept';
}

export async function startPipelineV3(userInput: string): Promise<void> {
  if (!beginTask(userInput)) return;
  _v3Budget = createBudget(240, 40);
  _nodeAttempts.clear();
  agentRouter.reset();

  try {
    const difficulty = await runDifficultyAssessmentV3(userInput);
    if (!difficulty || aborted()) return;

    // live 预检（fail-closed）：部门/能力/模型/端点矩阵不满足就不允许以 live 启动
    if (_state.runMode === 'live') {
      const pre = preflightLiveMode(_state.agents, _state.models);
      recordMonitorEvent('agent_route', 'command', '预检',
        pre.ok ? `live 预检通过（${pre.matrix.length} 项能力）` : `live 预检失败（${pre.issues.length} 项）`,
        { ok: pre.ok, issues: pre.issues, matrix: pre.matrix });
      if (!pre.ok) {
        const msg = pre.issues.map(i => `${i.capability}/${i.department}: ${i.reason}`).join('；');
        addLog(null, 'command', `live 模式预检失败：${msg}`, 'error');
        throw new Error(`live 模式预检未通过（fail-closed），请补全 Key/模型后再试：${msg}`);
      }
      addLog(null, 'command', 'live 模式预检通过：各部门均有可用执行者', 'success');
    }

    const graph: TaskGraph = chooseGraph(userInput, difficulty);
    const guard = validateGraph(graph);
    addLog(pickAgent('command'), 'command', describeGraph(graph), 'info');
    recordMonitorEvent('plan_validation', 'command', 'GraphGuard',
      guard.ok ? `任务图通过校验（${graph.nodes.length} 节点 · ${graph.risk} 风险）`
        : `任务图被拒绝：${guard.errors.join('；')}`,
      { nodes: graph.nodes.map(x => `${x.id}:${x.capability}`), errors: guard.errors, risk: graph.risk });
    if (!guard.ok) {
      throw new Error(`任务图未通过 GraphGuard 校验：${guard.errors.join('；')}`);
    }
    addMessage('command', 'review', 'task', `按任务图执行（${graph.nodes.length} 个节点）`);

    const results = await runGraph(graph, {
      isAborted: () => aborted() === true,
      waitIfPaused,
      execute: (node, inputs, feedback, attempt) => executeV3Node(node, inputs, feedback, attempt),
      review: (node, inputs, feedback, attempt) => executeV3ReviewNode(node, inputs, feedback, attempt),
      onNodeStart: (node) => {
        addLog(null, 'command', `▶ ${node.title}（${CAPABILITY_META[node.capability]?.label || node.capability}）`, 'info');
        notify();
      },
      onNodeDone: (node, result) => {
        saveNodeOutput(node, result);
        if (result.status === 'failed') {
          addLog(null, 'command', `✗ ${node.title} 执行失败：${result.error || '未知错误'}`, 'error');
        }
      },
      onGateFailure: handleV3GateFailure,
      incrementCounter: incrementV3Counter,
    });

    const deliver = results[graph.deliverableNodeId];
    if (!deliver) throw new Error('交付节点未执行，任务未完成');
    if (aborted()) return;

    addMessage('command', 'command', 'result',
      `任务图交付完成（${_state.reviewAuditCount} 次审查 · ${graph.nodes.length} 节点 · 预算 ${_v3Budget.taskCalls}/${_v3Budget.maxTaskCalls}）`);
    const outcome = computeTaskOutcome(_state);
    addLog(null, 'command',
      outcome === 'completed' ? '任务完成：全部产出为真实调用结果'
        : outcome === 'demo' ? '任务执行完成（含演示产出，不计入真实成功）'
          : '任务未完整交付',
      outcome === 'completed' ? 'success' : 'warning');
    recordMonitorEvent('node_output', 'command', '交付判定',
      `任务终态：${outcome}`, {
        outcome,
        nodeCount: graph.nodes.length,
        calls: _v3Budget.taskCalls,
        nodeOutputs: Object.keys(_state.nodeOutputs).length,
      });
    _persist('report', { outcome, graph, nodeOutputs: _state.nodeOutputs });
    notify();
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      addLog(null, 'command', '任务已被用户停止', 'warning');
      notify();
    } else {
      const message = err instanceof Error ? err.message : String(err);
      _state = {
        ..._state,
        errors: [..._state.errors, message],
        log: [..._state.log, {
          time: new Date().toISOString(), agentId: '', department: 'command',
          message: `流水线异常：${message}`, type: 'error',
        }],
      };
      notify();
    }
  } finally {
    _state = { ..._state, isRunning: false };
    _abortController = null;
    _pausedResolve = null;
    notify();
  }
}

/** 对外统一入口：按引擎模式分发；v3 未就绪时可用 setEngineMode('legacy') 回退 */
export async function startPipeline(userInput: string): Promise<void> {
  if (_engineMode === 'v3') return startPipelineV3(userInput);
  return startPipelineLegacy(userInput);
}

// ============ 控制 ============
export function pause() {
  _state = { ..._state, paused: true };
  notify();
}

const PAUSE_REASON_LABEL = {
  'api-retry': 'API 调用失败重试',
  'plan-review': '人工确认未通过审查的方案并继续',
  'retry-limit': '人工确认继续超过打回上限的任务',
} as const;

export function resume() {
  if (_state.paused && _state.pauseReason) {
    // 人工恢复留痕：尤其是越过审核门禁的恢复，必须可追溯
    const label = PAUSE_REASON_LABEL[_state.pauseReason] || _state.pauseReason;
    recordMonitorEvent('user_intervention', 'command', '用户', `人工恢复：${label}`, { pauseReason: _state.pauseReason });
    addLog(null, 'command', `人工恢复：${label}`, 'warning');
  }
  _state = { ..._state, paused: false, pauseReason: undefined };
  _pausedResolve?.();
  _pausedResolve = null;
  notify();
}

export function stop() {
  // 只中止信号并解除暂停，不立刻清 isRunning：
  // 旧任务会因请求被 abort 而快速收尾（finally 统一置 isRunning=false），
  // 避免"停止后立即开新任务"时旧异步链读到新任务的控制器/状态（并发竞态）。
  _abortController?.abort();
  // 真实取消：通知主进程中止该任务在途的模型请求（best-effort）
  try {
    const api = (window as unknown as { electronAPI?: { llmCancel?: (taskId: string) => Promise<unknown> } }).electronAPI;
    void api?.llmCancel?.(_state.taskId);
  } catch { /* 浏览器模式/旧 preload 忽略 */ }
  _state = { ..._state, paused: false };
  _pausedResolve?.();
  _pausedResolve = null;
  notify();
}

// 用户单点提问（穿透查询）——切到对应部门视角回答
export async function queryDepartment(
  dept: Department,
  question: string,
): Promise<string> {
  const agent = pickAgent(dept);
  recordMonitorEvent('user_intervention', dept, agent.name, `用户提问：${question}`);
  notify();

  const context = buildDeptContext(dept);
  const result = await callLLM(
    { ...agent, systemPrompt: `${agent.systemPrompt}\n\n你现在需要回答用户的单点提问。请基于以下部门上下文回答：\n${context}` },
    _state.models,
    'done' as PipelineStage,
    question,
    undefined,
    { demo: _state.runMode === 'demo', taskId: _state.taskId, nodeId: 'legacy:query' },
  );
  return result.content;
}

function buildDeptContext(dept: Department): string {
  const parts: string[] = [];
  if (_state.userInput) parts.push(`用户需求：${_state.userInput}`);
  if (_state.plan) parts.push(`指挥部方案：${JSON.stringify(_state.plan).slice(0, 300)}`);
  if (_state.difficulty) parts.push(`难度档位：${DIFFICULTY_LABEL[_state.difficulty]}`);
  if (_state.reviewFramework?.finalReport) {
    parts.push(`审查框架最新裁决：${_state.reviewFramework.finalReport.verdict}`);
  }
  // 该部门相关的阶段产出
  Object.entries(_state.stageOutputs).forEach(([stage, out]) => {
    if (STAGE_DEPT[stage as PipelineStage] === dept) {
      parts.push(`[${STAGE_LABELS[stage as PipelineStage]}] 产出：${out.content.slice(0, 200)}`);
    }
  });
  return parts.join('\n');
}

// ============ 持久化回调 ============
type PersistAction = 'task' | 'stageOutputs' | 'report' | 'state';

let _persistHandler: ((action: PersistAction, payload?: unknown) => Promise<void> | void) | null = null;

export function setPersistHandler(handler: (action: PersistAction, payload?: unknown) => Promise<void> | void) {
  _persistHandler = handler;
}

async function _persist(action: PersistAction, payload?: unknown) {
  try {
    await _persistHandler?.(action, payload);
  } catch {
    // 持久化失败不阻塞流水线
  }
}

// ============ 任务终态判定（结构化） ============
// completed = 必须有 done 阶段且全部阶段无失败、全部为 live 产出；
// demo      = 流程走完但含演示产出（不计入真实成功）；
// incomplete= 未完成/有失败阶段。
export type TaskOutcome = 'completed' | 'demo' | 'incomplete';

export function computeTaskOutcome(s: PipelineState): TaskOutcome {
  const outputs = Object.values(s.stageOutputs);
  if (outputs.length === 0) return 'incomplete';
  const done = s.stageOutputs['done'];
  if (!done || done.status !== 'done') return 'incomplete';
  if (outputs.some(o => o.status === 'error')) return 'incomplete';
  return outputs.some(o => o.source === 'demo') ? 'demo' : 'completed';
}

export function taskUsedDemo(s: PipelineState): boolean {
  return Object.values(s.stageOutputs).some(o => o.source === 'demo');
}

export function pushChatMessage(role: 'user' | 'assistant', content: string, name = ''): void {
  _state = {
    ..._state,
    chatMessages: [...(_state.chatMessages || []), {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role, name, content,
      timestamp: Date.now(),
    }].slice(-50),
  };
  notify();
}
