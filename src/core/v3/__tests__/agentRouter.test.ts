import { describe, it, expect } from 'vitest';
import type { Agent, Department } from '../../types';
import { AgentRouter } from '../agentRouter';

function agent(
  id: string,
  department: Department,
  role: Agent['role'],
  opts: Partial<Agent> = {},
): Agent {
  return {
    id,
    name: id,
    department,
    model: 'deepseek-v3',
    apiKey: '',
    role,
    status: 'idle',
    currentTask: '',
    systemPrompt: '',
    skills: [],
    hasKey: false,
    stats: { tasksCompleted: 0, errors: 0, avgTime: 0 },
    ...opts,
  };
}

const AGENTS: Agent[] = [
  agent('cmd-A', 'command', 'leader', { hasKey: true }),
  agent('cmd-B', 'command', 'member', { hasKey: true }),
  agent('info-A', 'info', 'leader', { hasKey: true }),
  agent('info-B', 'info', 'member', { hasKey: true }),
  agent('dev-A', 'develop', 'leader', { hasKey: true }),
  agent('dev-B', 'develop', 'member', { hasKey: true }),
  agent('rev-L', 'review', 'reviewer_logic', { hasKey: true }),
  agent('rev-F', 'review', 'reviewer_fact', { hasKey: true }),
  agent('rev-U', 'review', 'reviewer_user', { hasKey: true }),
];

describe('AgentRouter：部门与角色', () => {
  it('同部门 + 角色匹配优先：指挥部规划给 leader', () => {
    const r = new AgentRouter();
    const d = r.route({ department: 'command', capability: 'plan', agents: AGENTS, runMode: 'live' });
    expect(d.agent.department).toBe('command');
    expect(d.agent.role).toBe('leader');
    expect(d.crossDepartment).toBe(false);
  });

  it('执行类能力交给成员（队长不包揽执行）', () => {
    const r = new AgentRouter();
    const d = r.route({ department: 'info', capability: 'extract', agents: AGENTS, runMode: 'live' });
    expect(d.agent.id).toBe('info-B');
    expect(d.agent.role).toBe('member');
  });

  it('审查按 preferredRoles 选人（逻辑/事实/用户）', () => {
    const r = new AgentRouter();
    expect(r.route({ department: 'review', capability: 'review', agents: AGENTS, runMode: 'live', preferredRoles: ['reviewer_logic'] }).agent.id).toBe('rev-L');
    expect(r.route({ department: 'review', capability: 'review', agents: AGENTS, runMode: 'live', preferredRoles: ['reviewer_fact'] }).agent.id).toBe('rev-F');
    expect(r.route({ department: 'review', capability: 'review', agents: AGENTS, runMode: 'live', preferredRoles: ['reviewer_user'] }).agent.id).toBe('rev-U');
  });

  it('load 影响排序：正在执行中的 Agent 应降权', () => {
    const r = new AgentRouter();
    r.begin('info-B');
    r.begin('info-B');
    r.begin('info-B');
    const d = r.route({ department: 'info', capability: 'extract', agents: AGENTS, runMode: 'live' });
    expect(d.agent.id).not.toBe('info-B');
    r.end('info-B');
    r.end('info-B');
    r.end('info-B');
    const d2 = r.route({ department: 'info', capability: 'extract', agents: AGENTS, runMode: 'live' });
    expect(d2.agent.id).toBe('info-B');
  });

  it('失败率高的 Agent 降权', () => {
    const r = new AgentRouter();
    const risky = agent('info-B', 'info', 'member', {
      hasKey: true,
      stats: { tasksCompleted: 2, errors: 8, avgTime: 1000 },
    });
    const safe = agent('info-C', 'info', 'member', {
      hasKey: true,
      stats: { tasksCompleted: 8, errors: 0, avgTime: 5000 },
    });
    const d = r.route({ department: 'info', capability: 'extract', agents: [risky, safe], runMode: 'live' });
    expect(d.agent.id).toBe('info-C');
  });
});

describe('AgentRouter：Key 与跨部门回退', () => {
  it('本部门无 Key 时跨部门代办，并标记 crossDepartment', () => {
    const r = new AgentRouter();
    const noKey = AGENTS.map(a => ({ ...a, hasKey: a.department !== 'info' }));
    const d = r.route({ department: 'info', capability: 'extract', agents: noKey, runMode: 'live' });
    expect(d.crossDepartment).toBe(true);
    expect(d.reasons[0].code).toBe('cross-department-fallback');
    expect(d.agent.hasKey).toBe(true);
  });

  it('demo 模式不要求 Key', () => {
    const r = new AgentRouter();
    const noKey = AGENTS.map(a => ({ ...a, hasKey: false }));
    const d = r.route({ department: 'info', capability: 'extract', agents: noKey, runMode: 'demo' });
    expect(d.crossDepartment).toBe(false);
    expect(d.agent.department).toBe('info');
  });

  it('全部不可用时抛错（不返回空 Agent）', () => {
    const r = new AgentRouter();
    expect(() => r.route({
      department: 'review',
      capability: 'review',
      agents: [{ ...AGENTS[0], hasKey: false }],
      runMode: 'live',
    })).toThrow('没有可用 Agent');
  });

  it('excludeAgentIds 生效', () => {
    const r = new AgentRouter();
    const d = r.route({ department: 'info', capability: 'extract', agents: AGENTS, runMode: 'live', excludeAgentIds: ['info-B'] });
    expect(d.agent.id).not.toBe('info-B');
  });

  it('确定性 tie-breaker：同分按 agentId 字典序', () => {
    const r = new AgentRouter();
    const a = agent('x-2', 'info', 'member', { hasKey: true });
    const b = agent('x-1', 'info', 'member', { hasKey: true });
    const d = r.route({ department: 'info', capability: 'extract', agents: [a, b], runMode: 'live' });
    expect(d.agent.id).toBe('x-1');
    expect(d.candidates.length).toBe(2);
  });
});

describe('AgentRouter：v3.2 公平性与容量', () => {
  it('闲置越久越优先（不再偏向最近用过的 Agent）', () => {
    const r = new AgentRouter();
    const a = agent('idle-agent', 'info', 'member', { hasKey: true });
    const b = agent('recent-agent', 'info', 'member', { hasKey: true });
    // 让 recent-agent 最近被使用过
    r.begin('recent-agent');
    r.end('recent-agent');
    const d = r.route({ department: 'info', capability: 'extract', agents: [a, b], runMode: 'live' });
    expect(d.agent.id).toBe('idle-agent');
    expect(d.reasons.some(x => x.code === 'idle-longer')).toBe(true);
  });

  it('容量：达到 maxConcurrent 的 Agent 不再接新活', () => {
    const r = new AgentRouter();
    const busy = agent('busy', 'info', 'member', { hasKey: true, maxConcurrent: 1 });
    const free = agent('free', 'info', 'member', { hasKey: true, maxConcurrent: 2 });
    r.begin('busy'); // busy 达到容量上限
    const d = r.route({ department: 'info', capability: 'extract', agents: [busy, free], runMode: 'live' });
    expect(d.agent.id).toBe('free');
    r.end('busy');
  });

  it('EMA 质量反馈：连续失败的 Agent 降权', () => {
    const r = new AgentRouter();
    const flaky = agent('flaky', 'info', 'member', { hasKey: true });
    const stable = agent('stable', 'info', 'member', { hasKey: true });
    for (let i = 0; i < 4; i++) r.recordOutcome('flaky', false, 1000);
    for (let i = 0; i < 4; i++) r.recordOutcome('stable', true, 800);
    const d = r.route({ department: 'info', capability: 'extract', agents: [flaky, stable], runMode: 'live' });
    expect(d.agent.id).toBe('stable');
  });
});
