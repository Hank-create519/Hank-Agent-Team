// ============================================================
// 全局状态持久化 store —— Zustand + localStorage
// 参考 HankAI 审查系统 reviewStore.ts 设计
// 持久化：团队配置（agents/models）、任务历史
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Agent, ModelConfig } from '../core/types';
import { createAgents, DEFAULT_MODELS } from '../core/Pipeline';

const STORAGE_KEY = 'hank-agent-team-v1.0.1';

interface AppStore {
  // ===== 团队配置（持久化） =====
  agents: Agent[];
  models: ModelConfig[];
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  switchAgentModel: (agentId: string, modelId: string) => void;
  addModel: (model: ModelConfig) => void;
  removeModel: (modelId: string) => void;
  updateModel: (modelId: string, patch: Partial<ModelConfig>) => void;

  // ===== 配置加载标记 =====

  // ===== 任务历史（持久化最近 50 条摘要） =====
  history: HistoryItem[];
  addHistory: (item: HistoryItem) => void;

  // ===== Fixes 状态 (P0-3) =====
  taskFixes: Record<string, Record<string, 'accepted' | 'dismissed'>>;
  setFixStatus: (taskId: string, issueIndex: number, status: 'accepted' | 'dismissed') => void;

  // ===== UI 状态（不持久化的运行时状态走 Engine） =====
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export interface HistoryItem {
  taskId: string;
  userInput: string;
  difficulty: string | null;
  reviewAuditCount: number;
  contentRejectCount: number;
  codeRejectCount: number;
  success: boolean;
  // 任务终态：completed=真实完成；demo=演示完成；incomplete=未完成；failed/cancelled
  outcome?: 'completed' | 'demo' | 'incomplete' | 'failed' | 'cancelled';
  // 是否使用了演示模式（未配置 Key / mock 产出）
  demoUsed?: boolean;
  // 难度评估是否走了降级（LLM 失败 → 关键词兜底，审核强度可能失真）
  difficultyDegraded?: boolean;
  createdAt: string;
  summary: string;
  verdict?: string;
  issues?: Array<{ severity: string; desc: string; fixSuggestion?: string }>;
  suggestions?: string[];
  pros?: string[];
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // 团队配置
      agents: createAgents(),
      models: [...DEFAULT_MODELS],


      updateAgent: (id, patch) =>
        set((s) => ({
          agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),

      addAgent: (agent) =>
        set((s) => ({ agents: [...s.agents, agent] })),

      removeAgent: (id) =>
        set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),

      switchAgentModel: (agentId, modelId) =>
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId ? { ...a, model: modelId } : a
          ),
        })),

      addModel: (model) =>
        set((s) => ({
          models: s.models.some((m) => m.id === model.id) ? s.models : [...s.models, model],
        })),

      removeModel: (modelId) =>
        set((s) => ({
          models: s.models.filter((m) => m.id !== modelId),
        })),

      updateModel: (modelId, patch) =>
        set((s) => ({
          models: s.models.map((m) =>
            m.id === modelId ? { ...m, ...patch, id: modelId } : m
          ),
        })),

      // 任务历史
      history: [],
      addHistory: (item) =>
        set((s) => ({
          history: [item, ...s.history].slice(0, 50),
        })),

      // Fixes 状态
      taskFixes: {},
      setFixStatus: (taskId, issueIndex, status) =>
        set((s) => {
          const current = s.taskFixes[taskId] || {};
          return {
            taskFixes: {
              ...s.taskFixes,
              [taskId]: { ...current, [String(issueIndex)]: status },
            },
          };
        }),

      // UI
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: STORAGE_KEY,
      // 只持久化配置和历史，不持久化运行时引擎状态
      partialize: (s) => ({
        agents: s.agents,
        models: s.models,
        history: s.history,
        taskFixes: s.taskFixes,
      }),
      // v3.2 迁移：清理旧版本遗留字段（baseUrl 已废弃，主进程拒绝渲染层指定端点），
      // 并补齐默认并发容量；避免"已删除字段仍在 localStorage 里被持久化"。
      merge: (persisted, current) => {
        const saved = (persisted || {}) as Partial<AppStore>;
        const savedAgents = Array.isArray(saved.agents) ? saved.agents : current.agents;
        const agents = savedAgents.map(agent => {
          const rest = { ...agent } as Agent & { baseUrl?: string };
          delete rest.baseUrl; // 清理旧版本遗留字段（主进程已拒绝渲染层指定端点）
          return {
            ...rest,
            hasKey: Boolean(rest.hasKey),
            maxConcurrent: rest.maxConcurrent ?? 2,
          } as Agent;
        });
        return { ...current, ...saved, agents };
      },
    }
  )
);

// 从持久化 store 同步配置到 Engine

// 订阅 store 变化，自动同步给 Engine
export function subscribeConfigSync(syncFn: (agents: Agent[], models: ModelConfig[]) => void) {
  return useAppStore.subscribe((state, prevState) => {
    if (state.agents !== prevState.agents || state.models !== prevState.models) {
      syncFn(state.agents, state.models);
    }
  });
}
