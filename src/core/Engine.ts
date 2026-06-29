// ============================================================
// 流水线执行引擎 —— 真正驱动 8 阶段
// 参考 HankAI 审查系统 engine.ts 的 store + subscribe 模式：
//   - 模块级 _state + _listeners Set
//   - getState 返回只读快照
//   - App 层 subscribe 后同步到 React state
// 不直接依赖 React。
// ============================================================

import {
  PipelineState, PipelineStage, Agent, Department, Plan, LogEntry, StageOutput,
} from './types';
import { STAGE_PROGRESS, createInitialState } from './Pipeline';
import { bus } from './Communication';
import { callLLM, callAIWithTools } from './llm';
import { mockSummary } from './mockResponses';
import { clearSession } from './safetyGuard';

// ============ 阶段 → 负责部门映射 ============
const STAGE_DEPT: Record<PipelineStage, Department> = {
  init: 'command',
  audit_entry: 'review',
  extract: 'info',
  content_review: 'review',
  develop: 'develop',
  code_review: 'review',
  deploy: 'develop',
  done: 'command',
};

// 阶段中文标签
export const STAGE_LABELS: Record<PipelineStage, string> = {
  init: '制定方案',
  audit_entry: '审查把关',
  extract: '信息提取',
  content_review: '内容审核',
  develop: '开发编码',
  code_review: '代码审核',
  deploy: '部署上线',
  done: '完成交付',
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

// ============ 辅助 ============
function pickAgent(dept: Department): Agent | undefined {
  // 优先队长，否则第一个成员
  const deptAgents = _state.agents.filter(a => a.department === dept);
  return deptAgents.find(a => a.role === 'leader') || deptAgents[0];
}

function setAgentStatus(agentId: string, status: Agent['status'], currentTask = '') {
  _state = {
    ..._state,
    agents: _state.agents.map(a =>
      a.id === agentId ? { ...a, status, currentTask } : a
    ),
  };
}

function addLog(agent: Agent, department: Department, message: string, type: LogEntry['type'] = 'info') {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    agentId: agent.id,
    agentName: agent.name,
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
  // 真正经通信总线发送（带抄送指挥部）
  bus.send(from, to, msgType, _state.taskId, message);
}

const DEPT_NAME: Record<Department, string> = {
  command: '指挥部', info: '信息部', develop: '开发部', review: '审核部',
};

function setStage(stage: PipelineStage) {
  _state = { ..._state, stage, progress: STAGE_PROGRESS[stage] };
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

// 暂停门控：每次阶段切换前等待
async function waitIfPaused() {
  while (_state.paused) {
    await new Promise<void>(resolve => { _pausedResolve = resolve; });
    if (_abortController?.signal.aborted) return;
  }
}

// ============ 单阶段执行 ============
async function runStage(stage: PipelineStage, userPrompt: string, opts?: { forceAgent?: Agent }): Promise<string> {
  if (_abortController?.signal.aborted) return '';

  await waitIfPaused();
  if (_abortController?.signal.aborted) return '';

  const dept = STAGE_DEPT[stage];
  const agent = opts?.forceAgent || pickAgent(dept);
  if (!agent) throw new Error(`${DEPT_NAME[dept]} 没有可用 Agent`);

  setStage(stage);
  setAgentStatus(agent.id, 'running', STAGE_LABELS[stage]);
  addLog(agent, dept, `开始执行「${STAGE_LABELS[stage]}」`, 'info');
  notify();

  const start = Date.now();
  const result = await callLLM(agent, _state.models, stage, userPrompt);
  const elapsedMs = Date.now() - start;

  setAgentStatus(agent.id, 'done');
  const summary = extractSummary(stage, result.content);

  if (result.error) {
    addLog(agent, dept, result.error, 'warning');
  }

  saveStageOutput(stage, agent, result.content, summary, 'done', elapsedMs);
  addLog(agent, dept, `「${STAGE_LABELS[stage]}」完成 (${elapsedMs}ms${result.mock ? ' · 模拟' : ''})`, 'success');
  notify();

  return result.content;
}

// 从产出文本提取一句话摘要
function extractSummary(stage: PipelineStage, content: string): string {
  // 优先用 mock 摘要表（产出格式固定），真实 LLM 则取首行
  if (content.includes('【')) {
    return mockSummary(stage);
  }
  const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('```'));
  return firstLine ? firstLine.trim().slice(0, 80) : mockSummary(stage);
}

// ============ 审核打回判定 ============
// 解析审核产出是否通过。mock 默认通过；真实 LLM 看"通过/打回"关键词
function parseReviewResult(content: string): { approved: boolean; issues: string[] } {
  const txt = content.toLowerCase();
  const hasReject = /打回|不通过|驳回|拒绝|❌.*通过|判定：.*打回/.test(content);
  const hasApprove = /通过|✅|approve|判定：.*通过/.test(txt);
  if (hasReject && !hasApprove) {
    const issues = content.split('\n').filter(l => /问题|缺陷|漏洞|错误|建议|风险/.test(l)).slice(0, 5);
    return { approved: false, issues: issues.length ? issues : ['审核未通过，具体见产出'] };
  }
  return { approved: true, issues: [] };
}

// ============ 主流程 ============
export async function startPipeline(userInput: string) {
  if (_state.isRunning) return;

  _abortController = new AbortController();
  _state = {
    ..._state,
    isRunning: true,
    paused: false,
    userInput,
    taskId: `task_${Date.now()}`,
    stage: 'init',
    progress: 0,
    log: [],
    messages: [],
    errors: [],
    stageOutputs: {},
    plan: null,
    reviewRejectCount: 0,
  };

  // 重置所有 Agent 状态
  _state = { ..._state, agents: _state.agents.map(a => ({ ...a, status: 'idle', currentTask: '' })) };

  notify();

  try {
    // 1. init —— 指挥部制定方案
    const initOutput = await runStage('init', `请针对以下需求制定协作方案：\n\n${userInput}`);
    if (_abortController?.signal.aborted) return;
    try { _state = { ..._state, plan: JSON.parse(initOutput) as Plan }; } catch { /* 非 JSON 也继续 */ }
    notify();

    // 2. audit_entry —— 审核部把关
    addMessage('command', 'review', 'task', '方案待审查');
    await runStage('audit_entry', `请对以下方案进行入口把关：\n\n${initOutput}`);
    if (_abortController?.signal.aborted) return;
    addMessage('review', 'command', 'result', '审查完成');

    // 3. extract —— 信息部提取（带打回循环）
    let contentApproved = false;
    let extractAttempts = 0;
    while (!contentApproved && extractAttempts < 3) {
      if (_abortController?.signal.aborted) return;
      extractAttempts++;
      addMessage('command', 'info', 'task', '请提取关键信息');
      const extractOutput = await runStage('extract', `请从以下需求与方案中提取关键信息：\n\n需求：${userInput}\n\n方案：${initOutput}`);
      if (_abortController?.signal.aborted) return;

      addMessage('info', 'review', 'result', '信息提取完成，待内容审核');
      const reviewOutput = await runStage('content_review', `请审核以下信息提取结果的准确性：\n\n${extractOutput}`);
      if (_abortController?.signal.aborted) return;

      const { approved, issues } = parseReviewResult(reviewOutput);
      if (approved) {
        contentApproved = true;
        addMessage('review', 'info', 'ack', '内容审核通过');
      } else {
        _state = { ..._state, reviewRejectCount: _state.reviewRejectCount + 1 };
        addMessage('review', 'info', 'review', `内容审核打回：${issues.join('；')}`);
        addLog(pickAgent('review')!, 'review', `内容审核第 ${extractAttempts} 次打回`, 'warning');
        notify();
        if (_state.reviewRejectCount >= 3) {
          addLog(pickAgent('command')!, 'command', '审核打回超过 3 次，自动暂停', 'error');
          _state = { ..._state, paused: true };
          notify();
          await waitIfPaused();
          if (_abortController?.signal.aborted) return;
        }
      }
    }

    // 4. develop —— 开发部编码（带打回循环）
    let codeApproved = false;
    let devAttempts = 0;
    while (!codeApproved && devAttempts < 3) {
      if (_abortController?.signal.aborted) return;
      devAttempts++;
      addMessage('command', 'develop', 'task', '请编码实现');
      const devOutput = await runStage('develop', `请基于以下信息编码实现：\n\n需求：${userInput}\n\n信息：${_state.stageOutputs.extract?.content || ''}`);
      if (_abortController?.signal.aborted) return;

      addMessage('develop', 'review', 'result', '编码完成，待代码审核');
      const codeReviewOutput = await runStage('code_review', `请审核以下代码：\n\n${devOutput}`);
      if (_abortController?.signal.aborted) return;

      const { approved, issues } = parseReviewResult(codeReviewOutput);
      if (approved) {
        codeApproved = true;
        addMessage('review', 'develop', 'ack', '代码审核通过');
      } else {
        _state = { ..._state, reviewRejectCount: _state.reviewRejectCount + 1 };
        addMessage('review', 'develop', 'review', `代码审核打回：${issues.join('；')}`);
        addLog(pickAgent('review')!, 'review', `代码审核第 ${devAttempts} 次打回`, 'warning');
        notify();
        if (_state.reviewRejectCount >= 3) {
          addLog(pickAgent('command')!, 'command', '审核打回超过 3 次，自动暂停', 'error');
          _state = { ..._state, paused: true };
          notify();
          await waitIfPaused();
          if (_abortController?.signal.aborted) return;
        }
      }
    }

    // 5. deploy —— 部署，失败重试一次
    if (_abortController?.signal.aborted) return;
    addMessage('command', 'develop', 'task', '请执行部署');
    let deploySuccess = false;
    for (let attempt = 0; attempt < 2 && !deploySuccess; attempt++) {
      if (_abortController?.signal.aborted) return;
      if (attempt > 0) addLog(pickAgent('develop')!, 'develop', '部署重试第 1 次', 'warning');
      await runStage('deploy', `请执行部署。任务：${userInput}\n\n代码：${_state.stageOutputs.develop?.content || ''}`);
      const deployOut = _state.stageOutputs.deploy?.content || '';
      deploySuccess = /部署成功|✓ 部署成功|部署完成/i.test(deployOut);
      if (!deploySuccess && attempt === 1) {
        addLog(pickAgent('develop')!, 'develop', '部署重试仍失败，暂停汇报', 'error');
        _state = { ..._state, paused: true, errors: [..._state.errors, '部署失败'] };
        notify();
        await waitIfPaused();
        if (_abortController?.signal.aborted) return;
      }
    }
    addMessage('develop', 'command', 'result', deploySuccess ? '部署成功' : '部署失败');

    // 6. done —— 指挥部汇总
    if (_abortController?.signal.aborted) return;
    const summaryPrompt = `请汇总本次任务执行情况并交付：\n\n需求：${userInput}\n\n各阶段产出：\n${JSON.stringify(_state.stageOutputs, null, 2)}`;
    await runStage('done', summaryPrompt);
    addMessage('command', 'command', 'result', '任务交付完成');

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
    // 任务结束后保留 Agent done 状态供查看，不重置
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

// ============ 持久化回调（从 HankAI 审查系统同步） ============
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

// ============ ReviewEngine 类包装（从 HankAI 审查系统同步） ============
// 模块级函数保持兼容，类提供事件系统

type EngineEvent =
  | 'task_created' | 'task_complete' | 'task_error'
  | 'stage_start' | 'stage_complete'
  | 'progress' | 'ai_complete'
  | 'paused' | 'resumed' | 'stopped';

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
}

// 默认单例
export const engine = new ReviewEngine();
