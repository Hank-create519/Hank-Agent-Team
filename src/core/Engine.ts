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
  deploy: '部署上线',
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

function saveStageOutput(stage: PipelineStage, agent: Agent, content: string, summary: string, status: StageOutput['status'], elapsedMs: number) {
  const out: StageOutput = {
    stage, agentId: agent.id, agentName: agent.name,
    department: agent.department, content, summary, status, elapsedMs,
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

  const dept = STAGE_DEPT[stage];
  const agent = opts?.forceAgent || pickAgent(dept);
  if (!agent) throw new Error(`${DEPT_NAME[dept]} 没有可用 Agent`);

  setStage(stage);
  setAgentStatus(agent.id, 'running', STAGE_LABELS[stage]);
  addLog(agent, dept, `开始执行「${STAGE_LABELS[stage]}」`, 'info');
  recordMonitorEvent('framework_phase', dept, agent.name, `开始「${STAGE_LABELS[stage]}」`);
  notify();

  const start = Date.now();
  const result = await callLLM(agent, _state.models, stage, userPrompt);
  const elapsedMs = Date.now() - start;

  setAgentStatus(agent.id, 'done');
  const summary = extractSummary(stage, result.content);

  if (result.error) addLog(agent, dept, result.error, 'warning');

  saveStageOutput(stage, agent, result.content, summary, 'done', elapsedMs);
  addLog(agent, dept, `「${STAGE_LABELS[stage]}」完成 (${elapsedMs}ms${result.mock ? ' · 模拟' : ''})`, 'success');
  notify();

  return result.content;
}

// 从产出文本提取一句话摘要
function extractSummary(stage: PipelineStage, content: string): string {
  if (content.includes('【')) return mockSummary(stage);
  const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('```'));
  return firstLine ? firstLine.trim().slice(0, 80) : mockSummary(stage);
}

// ============ 审核打回判定 ============
function parseReviewResult(content: string): { approved: boolean; issues: string[] } {
  const txt = content.toLowerCase();
  const hasReject = /打回|不通过|驳回|拒绝|❌.*通过|判定：.*打回|驳回/.test(content);
  const hasApprove = /通过|✅|approve|判定：.*通过/.test(txt);
  if (hasReject && !hasApprove) {
    const issues = content.split('\n').filter(l => /问题|缺陷|漏洞|错误|建议|风险/.test(l)).slice(0, 5);
    return { approved: false, issues: issues.length ? issues : ['审核未通过，具体见产出'] };
  }
  return { approved: true, issues: [] };
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
    `审查框架裁决：${verdictLabel}`, 'done', report.totalElapsedMs);

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

      addMessage('command', 'develop', 'task', '请部署');
      await runStage('deploy', `请执行部署。任务：${userInput}`);
      if (aborted()) return;

      // 终审
      await runStage('done', `请汇总交付：\n\n需求：${userInput}\n\n产出：${_state.stageOutputs.develop?.content || ''}`);
      addMessage('command', 'command', 'result', '任务交付完成（简单档快速通道）');
      return;
    }

    // ========================================================
    // 第二步：方案精炼（中等/复杂档）
    // ========================================================
    // init —— 指挥部制定方案
    const initOutput = await runStage('init', `请针对以下需求制定协作方案：\n\n${userInput}`);
    if (aborted()) return;
    try { _state = { ..._state, plan: JSON.parse(initOutput) as Plan }; } catch { /* 非 JSON 也继续 */ }
    notify();

    // audit_entry —— 审查框架深度把关（方案级）
    addMessage('command', 'review', 'task', '方案待审查框架把关');
    await executeReviewFramework(initOutput, 'plan', _abortController.signal);
    if (aborted()) return;
    addMessage('review', 'command', 'result', `审查框架完成（${_state.reviewFramework?.totalRounds || 1} 轮）`);

    // 方案审查被驳回 → 打回重新制定（最多1次）
    if (_state.reviewFramework?.finalReport?.verdict === 'reject') {
      addLog(null, 'command', '审查框架驳回方案，指挥部重新制定', 'warning');
      notify();
      const revisedOutput = await runStage('init',
        `审查框架驳回了上一版方案，请根据以下反馈重新制定：\n\n原始需求：${userInput}\n\n审查反馈：${formatReviewReport(_state.reviewFramework!.finalReport!)}`);
      if (aborted()) return;
      try { _state = { ..._state, plan: JSON.parse(revisedOutput) as Plan }; } catch { /* */ }
      notify();
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
      const reviewOutput = await runStage('content_review', `请审核以下信息提取结果的准确性：\n\n${extractOutput}`);
      if (aborted()) return;

      const { approved, issues } = parseReviewResult(reviewOutput);
      if (approved) {
        contentApproved = true;
        addMessage('review', 'info', 'ack', '内容审核通过');
      } else {
        _state = { ..._state, contentRejectCount: _state.contentRejectCount + 1 };
        addMessage('review', 'info', 'review', `内容审核打回：${issues.join('；')}`);
        addLog(pickAgent('review'), 'review', `内容审核第 ${extractAttempts} 次打回`, 'warning');
        notify();
        if (_state.contentRejectCount >= 3) {
          // 复杂档：内容多次打回 → 触发审查框架深度复审
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
        }
      }
    }

    // ========================================================
    // 第四步：双重审计防线
    // ========================================================
    // develop —— 开发部编码（带代码审核打回循环）
    let codeApproved = false;
    let devAttempts = 0;
    while (!codeApproved && devAttempts < 3) {
      if (aborted()) return;
      devAttempts++;
      addMessage('command', 'develop', 'task', '请编码实现');
      const devOutput = await runStage('develop',
        `请基于以下信息编码实现：\n\n需求：${userInput}\n\n信息：${_state.stageOutputs.extract?.content || ''}`);
      if (aborted()) return;

      // 第一道防线：部门级代码审核
      addMessage('develop', 'review', 'result', '编码完成，待代码审核');
      const codeReviewOutput = await runStage('code_review', `请审核以下代码：\n\n${devOutput}`);
      if (aborted()) return;

      const { approved, issues } = parseReviewResult(codeReviewOutput);
      if (approved) {
        codeApproved = true;
        addMessage('review', 'develop', 'ack', '代码审核通过');

        // 第二道防线：复杂档 → 审查框架系统级兜底深度审计
        if (_state.difficulty === 'complex') {
          addLog(null, 'review', '复杂档：启动系统级深度审计（第二道防线）', 'info');
          notify();
          await executeReviewFramework(devOutput, 'code', _abortController.signal);
          if (aborted()) return;

          // 兜底审计驳回 → 视为代码审核不通过，重新开发
          if (_state.reviewFramework?.finalReport?.verdict === 'reject') {
            codeApproved = false;
            addLog(null, 'review', '系统级深度审计驳回，打回开发部', 'warning');
            _state = { ..._state, codeRejectCount: _state.codeRejectCount + 1 };
            notify();
          } else {
            addLog(null, 'review', '系统级深度审计通过', 'success');
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
        }
      }
    }

    // ========================================================
    // 第五步：终审与交付
    // ========================================================
    if (aborted()) return;
    addMessage('command', 'develop', 'task', '请执行部署');
    let deploySuccess = false;
    for (let attempt = 0; attempt < 2 && !deploySuccess; attempt++) {
      if (aborted()) return;
      if (attempt > 0) addLog(pickAgent('develop'), 'develop', '部署重试第 1 次', 'warning');
      await runStage('deploy', `请执行部署。任务：${userInput}\n\n代码：${_state.stageOutputs.develop?.content || ''}`);
      const deployOut = _state.stageOutputs.deploy?.content || '';
      deploySuccess = /部署成功|✓ 部署成功|部署完成/i.test(deployOut);
      if (!deploySuccess && attempt === 1) {
        addLog(pickAgent('develop'), 'develop', '部署重试仍失败，暂停汇报', 'error');
        _state = { ..._state, paused: true, errors: [..._state.errors, '部署失败'] };
        notify();
        await waitIfPaused();
        if (aborted()) return;
      }
    }
    addMessage('develop', 'command', 'result', deploySuccess ? '部署成功' : '部署失败');

    // done —— 指挥部终审（标注审查框架执行情况）
    if (aborted()) return;
    const auditInfo = _state.reviewAuditCount > 0
      ? `\n\n【本次任务已经过 ${_state.reviewAuditCount} 轮审查框架审核】`
      : '';
    const summaryPrompt = `请汇总本次任务执行情况并交付：\n\n需求：${userInput}\n\n各阶段产出：\n${JSON.stringify(_state.stageOutputs, null, 2)}${auditInfo}`;
    await runStage('done', summaryPrompt);
    addMessage('command', 'command', 'result', `任务交付完成（${_state.reviewAuditCount} 轮审查框架审核）`);

  } catch (err: any) {
    const msg = err?.message || String(err);
    _state = {
      ..._state,
      errors: [..._state.errors, msg],
      log: [..._state.log, {
        time: new Date().toISOString(), agentId: '', department: 'command',
        message: `流水线异常：${msg}`, type: 'error',
      }],
    };
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
  _abortController?.abort();
  _state = { ..._state, paused: false, isRunning: false };
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
