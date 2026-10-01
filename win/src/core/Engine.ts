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
  PipelineState, PipelineStage, Agent, Department, Plan, LogEntry, StageOutput,
  Difficulty, ReviewFrameworkState, ReviewPhase, MonitorEvent,
} from './types';
import {
  STAGE_PROGRESS_FULL, STAGE_PROGRESS_MEDIUM, STAGE_PROGRESS_SIMPLE,
  createInitialState,
} from './Pipeline';
import { bus } from './Communication';
import { callLLM } from './llm';
import { safeJsonParse } from './llm';
import { getSkills } from './skillRegistry';
import { listSkills } from './skillRegistry';
import { mockSummary } from './mockResponses';
import { clearSession } from './safetyGuard';
import { assessDifficulty } from './difficultyRouter';
import { runReviewFramework } from './ReviewFramework';

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

function pickReviewerAgent(role: Agent['role']): Agent {
  const agent = _state.agents.find(a => a.department === 'review' && a.role === role);
  if (agent) return agent;
  // 兜底：审核部任意成员
  const fallback = _state.agents.find(a => a.department === 'review');
  if (!fallback) throw new Error('审核部没有可用 Agent');
  return fallback;
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
  bus.send(from, to, msgType, _state.taskId, message);
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
  metadata?: Record<string, any>,
) {
  const evt: MonitorEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    type, department, agentName, content,
    metadata,
  };
  _state = { ..._state, monitorEvents: [..._state.monitorEvents, evt].slice(-300) };
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

  // 上下文窗口溢出保护：超出阈值时保留头部 + 尾部
  const MAX_PROMPT_LEN = 32000; // 保守值，约 8000 tokens
  let finalPrompt = userPrompt;
  if (userPrompt.length > MAX_PROMPT_LEN) {
    const head = userPrompt.slice(0, MAX_PROMPT_LEN * 2 / 3);
    const tail = userPrompt.slice(-MAX_PROMPT_LEN / 3);
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
  let result = await callLLM(effectiveAgent, _state.models, stage, finalPrompt, _abortController?.signal);
  while (result.status === 'failed') {
    setAgentStatus(agent.id, 'error', STAGE_LABELS[stage]);
    saveStageOutput(stage, agent, '', `调用失败：${result.error || '未知错误'}`, 'error', 0, 'live');
    addLog(agent, dept, `LLM 调用失败：${result.error || '未知错误'}。已暂停 —— 点击「继续」重试本阶段，或「停止」结束任务。`, 'error');
    recordMonitorEvent('api_failure', dept, agent.name,
      `「${STAGE_LABELS[stage]}」真实调用失败，暂停等待处理`, { stage, error: result.error });
    notify();
    await waitIfPaused();
    if (aborted()) throw new DOMException('Aborted', 'AbortError');
    setAgentStatus(agent.id, 'running', STAGE_LABELS[stage]);
    addLog(agent, dept, `重试「${STAGE_LABELS[stage]}」`, 'info');
    notify();
    result = await callLLM(effectiveAgent, _state.models, stage, finalPrompt, _abortController?.signal);
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
// 优先解析审核员按要求输出的 JSON 结论（{"result":"approved"|"rejected","issues":[...]}），
// 解析不到时回退为 default-deny 文本判定：必须"无拒绝词"且"有显式通过模式"才算通过。
export function parseReviewResult(content: string): { approved: boolean; issues: string[] } {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const { value, success } = safeJsonParse<{ result?: string; issues?: string[] }>(jsonMatch[0], {});
    if (success && value && (value.result === 'approved' || value.result === 'rejected')) {
      return {
        approved: value.result === 'approved',
        issues: Array.isArray(value.issues) ? value.issues.slice(0, 5).map(String) : [],
      };
    }
  }

  const hasReject = /打回|不通过|驳回|拒绝|❌/.test(content);
  const hasExplicitApprove = /(?:明确结论|审核结论|最终结论|判定)\s*[:：]?\s*(?:✅\s*)?(?:通过|approve\b)/i.test(content)
    || /^\s*(?:✅\s*)?(?:通过|approved)\s*$/im.test(content);
  if (hasReject || !hasExplicitApprove) {
    const issues = content.split('\n').filter(l => /问题|缺陷|漏洞|错误|建议|风险/.test(l)).slice(0, 5);
    return { approved: false, issues: issues.length ? issues : [hasReject ? '审核存在拒绝结论' : '审核没有给出明确通过结论'] };
  }
  return { approved: true, issues: [] };
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
      _state.reviewFramework = { ...rfState, phase };
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
function formatReviewReport(report: any): string {
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
    report.issues.forEach((i: any) => {
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
export async function startPipeline(userInput: string) {
  if (_state.isRunning) return;

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
    monitorEvents: [],
    reviewAuditCount: 0,
    // 运行模式：全员无 Key = 演示任务；live 任务中 demo 来源产出不得通过门禁
    runMode: _state.agents.some(a => a.apiKey) ? 'live' : 'demo',
  };

  _state = { ..._state, agents: _state.agents.map(a => ({ ...a, status: 'idle', currentTask: '' })) };
  notify();

  try {
    // ========================================================
    // 第一步：难度分流
    // ========================================================
    setStage('difficulty_assess');
    const cmdAgent = pickAgent('command');
    setAgentStatus(cmdAgent.id, 'running', '难度评估');
    addLog(cmdAgent, 'command', '指挥部启动难度评估', 'info');
    notify();

    const assessment = await assessDifficulty(userInput, cmdAgent, _state.models, _abortController.signal);
    if (aborted()) return;

    if (assessment.degraded) {
      addLog(cmdAgent, 'command', '难度评估降级：LLM 调用失败，已使用关键词兜底判定（本次审核强度可能与预期不符）', 'warning');
      recordMonitorEvent('difficulty_assess', 'command', cmdAgent.name,
        '难度评估降级：API 失败，使用关键词兜底', { degraded: true, difficulty: assessment.difficulty });
    }
    _state.difficulty = assessment.difficulty;
    _state.difficultyReason = assessment.reason;
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
      const { value: fullOutput, success } = safeJsonParse<any>(initOutput, {});
      if (success && fullOutput) {
        // 兼容两种输出结构：提示词要求的嵌套 { plan: {...}, agents: [...] }
        // 与模型自行输出的顶层 { summary, steps, ... }
        const planSrc = fullOutput.plan || fullOutput;
        const plan: Plan = {
          summary: planSrc.summary || '',
          steps: planSrc.steps || [],
          risks: planSrc.risks || [],
          suggestedApproach: planSrc.suggestedApproach || '',
        };
        _state = { ..._state, plan };
        // P1-5: 解析 Agent Skill 动态分配
        if (fullOutput.agents && Array.isArray(fullOutput.agents)) {
          const assignments: Array<{ role: string; assignedSkills: string[] }> = fullOutput.agents
            .filter((x: any) => x && typeof x.role === 'string' && Array.isArray(x.assignedSkills));
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
      await executeReviewFramework(currentPlanOutput, 'plan', _abortController.signal);
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
      const { value: fullOutput, success: revisedOk } = safeJsonParse<any>(currentPlanOutput, {});
      if (revisedOk && fullOutput) {
        const planSrc = fullOutput.plan || fullOutput;
        const revisedPlan: Plan = {
          summary: planSrc.summary || '',
          steps: planSrc.steps || [],
          risks: planSrc.risks || [],
          suggestedApproach: planSrc.suggestedApproach || '',
        };
        _state = { ..._state, plan: revisedPlan };
        if (fullOutput.agents && Array.isArray(fullOutput.agents)) {
          const assignments: Array<{ role: string; assignedSkills: string[] }> = fullOutput.agents
            .filter((x: any) => x && typeof x.role === 'string' && Array.isArray(x.assignedSkills));
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
      _state = { ..._state, paused: true };
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
          await executeReviewFramework(code, 'code', _abortController.signal);
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
              await executeReviewFramework(extractOutput, 'plan', _abortController.signal);
              if (aborted()) return;
            }
            addLog(pickAgent('command'), 'command', '内容审核打回超过 3 次，自动暂停', 'error');
            _state = { ..._state, paused: true };
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
            await executeReviewFramework(devOutput, 'code', _abortController.signal);
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
            _state = { ..._state, paused: true };
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

  } catch (err: any) {
    // 用户主动停止：静默收尾，不算异常
    if (err?.name === 'AbortError') {
      _state = { ..._state, log: [..._state.log, {
        time: new Date().toISOString(), agentId: '', department: 'command',
        message: '任务已被用户停止', type: 'warning',
      }] };
    } else {
      const msg = err?.message || String(err);
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

// ============ 控制 ============
export function pause() {
  _state = { ..._state, paused: true };
  notify();
}

export function resume() {
  _state = { ..._state, paused: false };
  _pausedResolve?.();
  _pausedResolve = null;
  notify();
}

export function stop() {
  // 只中止信号并解除暂停，不立刻清 isRunning：
  // 旧任务会因请求被 abort 而快速收尾（finally 统一置 isRunning=false），
  // 避免"停止后立即开新任务"时旧异步链读到新任务的控制器/状态（并发竞态）。
  _abortController?.abort();
  _state = { ..._state, paused: false };
  _pausedResolve?.();
  _pausedResolve = null;
  clearSession(_state.taskId);
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
    'done' as any,
    question,
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

let _persistHandler: ((action: PersistAction, payload?: any) => Promise<void> | void) | null = null;

export function setPersistHandler(handler: (action: PersistAction, payload?: any) => Promise<void> | void) {
  _persistHandler = handler;
}

async function _persist(action: PersistAction, payload?: any) {
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
  if (!done || done.status === 'error') return 'incomplete';
  if (outputs.some(o => o.status === 'error')) return 'incomplete';
  return outputs.some(o => o.source === 'demo') ? 'demo' : 'completed';
}

// 兼容旧调用点：非 incomplete 即完成（demo 也算完成，但历史里会单独标记）
export function computeTaskSuccess(s: PipelineState): boolean {
  return computeTaskOutcome(s) !== 'incomplete';
}

export function taskUsedDemo(s: PipelineState): boolean {
  return Object.values(s.stageOutputs).some(o => o.source === 'demo');
}

// ============ ReviewEngine 类包装 ============
type EngineEvent =
  | 'task_created' | 'task_complete' | 'task_error'
  | 'stage_start' | 'stage_complete'
  | 'progress' | 'ai_complete'
  | 'paused' | 'resumed' | 'stopped'
  | 'difficulty_assessed' | 'review_framework_update';

type EventHandler = (...args: any[]) => void;

export class ReviewEngine {
  private _eventHandlers = new Map<EngineEvent, Set<EventHandler>>();

  on(event: EngineEvent, handler: EventHandler): () => void {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, new Set());
    this._eventHandlers.get(event)!.add(handler);
    return () => this._eventHandlers.get(event)?.delete(handler);
  }

  emit(event: EngineEvent, ...args: any[]) {
    this._eventHandlers.get(event)?.forEach(h => h(...args));
  }

  subscribe(fn: () => void) { return subscribe(fn); }
  getState() { return getState(); }
  syncFromApp(state: PipelineState) { syncFromApp(state); }
  pause() { pause(); this.emit('paused'); }
  resume() { resume(); this.emit('resumed'); }
  stop() { stop(); this.emit('stopped'); }
  setPersistHandler(handler: any) { setPersistHandler(handler); }

  async startPipeline(userInput: string) {
    this.emit('task_created', _state.taskId || `task_${Date.now()}`);
    try {
      await startPipeline(userInput);
      if (_state.errors.length > 0) {
        this.emit('task_error', _state.errors);
      } else {
        this.emit('task_complete', _state.stageOutputs);
      }
    } catch (e: any) {
      this.emit('task_error', [e?.message || String(e)]);
      throw e;
    }
  }

  async queryDepartment(dept: Department, question: string) {
    return queryDepartment(dept, question);
  }
}

// 默认单例
export const engine = new ReviewEngine();

// 对话面板消息发送（ChatPanel）
export async function sendChatMessage(message: string): Promise<void> {
  // ChatPanel integration — placeholder
  // In a full implementation, this would post to the pipeline's message bus.
  console.log('[ChatPanel]', message);
}
