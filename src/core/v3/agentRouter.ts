// ============================================================
// AgentRouter（v3.1）：把"选谁执行"从各调用点收敛到一处。
//
// 目标（对齐技术升级方案）：
//   1) 同部门、已配置 Key 的 Agent 优先；
//   2) 与任务角色/能力最匹配的 Agent 优先；
//   3) 空闲、历史失败率低、平均耗时短、最近使用少的优先；
//   4) 队长负责规划/汇总/复核，成员负责执行；
//   5) 仅当本部门无可用 Key 时才跨部门代办，并标记 crossDepartment（由调用方写审计）。
//
// 设计约束：纯函数式评分 + 显式 tie-breaker（agentId 字典序），保证同样输入同样结果，
// 便于审计与测试；运行时负载与最近使用记录在本模块内维护。
// ============================================================

import type { Agent, Department } from '../types';
import type { CapabilityId } from './types';

export interface RouteRequest {
  department: Department;
  capability: CapabilityId;
  agents: Agent[];
  runMode: 'live' | 'demo';
  /** 显式偏好角色（review 策略用；不传则按能力默认） */
  preferredRoles?: Agent['role'][];
  /** 排除的 Agent（例如已连续失败的） */
  excludeAgentIds?: string[];
}

export interface RouteReason {
  code:
    | 'department-match'
    | 'preferred-role'
    | 'idle'
    | 'has-key'
    | 'load'
    | 'low-failure'
    | 'fast-avg'
    | 'idle-longer'
    | 'recent-failures'
    | 'cross-department-fallback';
  detail: string;
}

export interface RouteDecision {
  agent: Agent;
  /** 是否跨部门代办（调用方必须写审计事件） */
  crossDepartment: boolean;
  /** 供审计/调试：所有候选及得分（按分数降序） */
  candidates: Array<{ agentId: string; score: number }>;
  reasons: RouteReason[];
}

const ROLE_BY_CAPABILITY: Record<CapabilityId, Agent['role'][]> = {
  plan: ['leader', 'member'],
  extract: ['member', 'leader'],
  research: ['member', 'leader'],
  draft: ['member', 'leader'],
  review: ['reviewer_logic', 'reviewer_fact', 'reviewer_user', 'member'],
  verify: ['member', 'leader'],
  deliver: ['leader', 'member'],
};

/** 能力 → 默认部门（规划/汇总在指挥部，检索/提取在信息部，产出在开发部，审查在审核部） */
export const DEPARTMENT_BY_CAPABILITY: Record<CapabilityId, Department> = {
  plan: 'command',
  extract: 'info',
  research: 'info',
  draft: 'develop',
  review: 'review',
  verify: 'review',
  deliver: 'command',
};

interface AgentRuntimeStats {
  inFlight: number;
  lastUsedAt: number;
  /** EMA：近期失败率/平均耗时（用于路由质量反馈） */
  emaFailure: number | null;
  emaTimeMs: number | null;
}

export class AgentRouter {
  private stats = new Map<string, AgentRuntimeStats>();

  reset(): void {
    this.stats.clear();
  }

  begin(agentId: string): void {
    const s = this.stats.get(agentId) || { inFlight: 0, lastUsedAt: 0, emaFailure: null, emaTimeMs: null };
    s.inFlight += 1;
    s.lastUsedAt = Date.now();
    this.stats.set(agentId, s);
  }

  /** 记录一次执行结果（EMA，α=0.3），供后续路由使用 */
  recordOutcome(agentId: string, ok: boolean, elapsedMs: number): void {
    const s = this.stats.get(agentId) || { inFlight: 0, lastUsedAt: 0, emaFailure: null, emaTimeMs: null };
    const alpha = 0.3;
    s.emaFailure = s.emaFailure === null ? (ok ? 0 : 1) : s.emaFailure * (1 - alpha) + (ok ? 0 : 1) * alpha;
    s.emaTimeMs = s.emaTimeMs === null ? elapsedMs : s.emaTimeMs * (1 - alpha) + elapsedMs * alpha;
    this.stats.set(agentId, s);
  }

  getStats(agentId: string): AgentRuntimeStats | undefined {
    return this.stats.get(agentId);
  }

  end(agentId: string): void {
    const s = this.stats.get(agentId);
    if (!s) return;
    s.inFlight = Math.max(0, s.inFlight - 1);
    this.stats.set(agentId, s);
  }

  route(req: RouteRequest): RouteDecision {
    const excluded = new Set(req.excludeAgentIds || []);
    const sameDept = req.agents.filter(a => a.department === req.department && !excluded.has(a.id));
    const all = req.agents.filter(a => !excluded.has(a.id));

    const keyOk = (a: Agent): boolean => (req.runMode === 'demo' ? true : Boolean(a.hasKey));
    const statsOf = (agentId: string) => this.stats.get(agentId) || { inFlight: 0, lastUsedAt: 0, emaFailure: null, emaTimeMs: null };
    // 容量：优先选择未达 maxConcurrent 的 Agent；全部满载时才退化为选负载最低者
    const capacityOk = (a: Agent): boolean => statsOf(a.id).inFlight < (a.maxConcurrent ?? 2);
    const candidatesInDept = sameDept.filter(keyOk);
    const crossDepartment = candidatesInDept.length === 0;
    const basePool = crossDepartment ? all.filter(keyOk) : candidatesInDept;
    const pool = basePool.filter(capacityOk).length > 0 ? basePool.filter(capacityOk) : basePool;

    if (pool.length === 0) {
      throw new Error(`没有可用 Agent：部门「${req.department}」在 ${req.runMode} 模式下无可用执行者`);
    }

    const preferredRoles = req.preferredRoles && req.preferredRoles.length > 0
      ? req.preferredRoles
      : ROLE_BY_CAPABILITY[req.capability];

    const scored = pool.map(agent => {
      const reasons: RouteReason[] = [];
      let score = 0;
      const rt = statsOf(agent.id);

      if (agent.department === req.department) {
        score += 40;
        reasons.push({ code: 'department-match', detail: `与目标部门一致（${req.department}）` });
      }
      if (preferredRoles.includes(agent.role)) {
        const idx = preferredRoles.indexOf(agent.role);
        const bonus = Math.max(20, 50 - idx * 20);
        score += bonus;
        reasons.push({ code: 'preferred-role', detail: `角色匹配（${agent.role}，偏好第 ${idx + 1} 位）` });
      }
      if (agent.status === 'idle') {
        score += 10;
        reasons.push({ code: 'idle', detail: '空闲' });
      }
      if (agent.hasKey) {
        score += 15;
        reasons.push({ code: 'has-key', detail: '已配置 Key' });
      }
      if (rt.inFlight === 0) {
        score += 8;
        reasons.push({ code: 'load', detail: '无并发负载' });
      } else {
        score -= 6 * rt.inFlight;
      }
      const total = agent.stats.tasksCompleted + agent.stats.errors;
      const failureRate = total > 0 ? agent.stats.errors / total : 0;
      if (failureRate === 0 && total > 0) {
        score += 8;
        reasons.push({ code: 'low-failure', detail: '历史失败率为 0' });
      } else {
        score -= Math.round(failureRate * 20);
      }
      if (agent.stats.avgTime > 0) {
        // 平均耗时越短加分越多（上限 6 分）
        score += Math.max(0, 6 - Math.round(agent.stats.avgTime / 30000));
        if (agent.stats.avgTime <= 30000) {
          reasons.push({ code: 'fast-avg', detail: `平均耗时 ${Math.round(agent.stats.avgTime)}ms` });
        }
      }
      // 公平性：闲置越久越优先（避免总是压给最近用过的 Agent）；从未使用视为最久闲置
      const idleMinutes = rt.lastUsedAt === 0 ? Infinity : (Date.now() - rt.lastUsedAt) / 60000;
      const idleBonus = idleMinutes === Infinity ? 12 : Math.min(12, Math.round(idleMinutes));
      score += idleBonus;
      if (idleBonus > 0) {
        reasons.push({
          code: 'idle-longer',
          detail: idleMinutes === Infinity ? '从未使用（优先）' : `已闲置 ${idleBonus} 分钟`,
        });
      }
      // EMA 质量反馈：近期失败率高扣分、耗时短加分
      if (rt.emaFailure !== null) {
        score -= Math.round(rt.emaFailure * 25);
        if (rt.emaFailure > 0.5) reasons.push({ code: 'recent-failures', detail: `近期失败率 ${(rt.emaFailure * 100).toFixed(0)}%` });
      }
      if (rt.emaTimeMs !== null) {
        score += Math.max(0, 5 - Math.round(rt.emaTimeMs / 30000));
      }
      return { agent, score, reasons };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.agent.id.localeCompare(b.agent.id);
    });

    const best = scored[0];
    const reasons = [...best.reasons];
    if (crossDepartment) {
      reasons.unshift({
        code: 'cross-department-fallback',
        detail: `本部门无可用 Key/执行者，跨部门代办：${best.agent.department}`,
      });
    }

    return {
      agent: best.agent,
      crossDepartment,
      candidates: scored.map(s => ({ agentId: s.agent.id, score: s.score })),
      reasons,
    };
  }
}

/** 全局单例：运行时维护负载/最近使用；测试可 new AgentRouter() 独立实例 */
export const agentRouter = new AgentRouter();
