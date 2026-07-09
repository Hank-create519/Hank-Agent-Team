// ============================================================
// 全局状态持久化 store —— Zustand + localStorage
// 参考 HankAI 审查系统 reviewStore.ts 设计
// 持久化：团队配置（agents/models）、任务历史
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Agent, ModelConfig, PipelineState } from '../core/types';
import { createAgents, DEFAULT_MODELS } from '../core/Pipeline';

const STORAGE_KEY = 'hank-agent-team-v1.0.1';

interface AppStore {
  // ===== 团队配置（持久化） =====
  agents: Agent[];
  models: ModelConfig[];
  setAgents: (agents: Agent[]) => void;
  setModels: (models: ModelConfig[]) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  switchAgentModel: (agentId: string, modelId: string) => void;
  addModel: (model: ModelConfig) => void;
  removeModel: (modelId: string) => void;
  updateModel: (modelId: string, patch: Partial<ModelConfig>) => void;

  // ===== 配置加载标记 =====
  configLoaded: boolean;
  markConfigLoaded: () => void;

  // ===== 任务历史（持久化最近 50 条摘要） =====
  history: HistoryItem[];
  addHistory: (item: HistoryItem) => void;
  updateHistory: (taskId: string, patch: Partial<HistoryItem>) => void;
  clearHistory: () => void;

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
  createdAt: string;
  summary: string;
  reviewReport?: any;
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

      setAgents: (agents) => set({ agents }),
      setModels: (models) => set({ models }),

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

      // 配置加载
      configLoaded: false,
      markConfigLoaded: () => set({ configLoaded: true }),

      // 任务历史
      history: [],
      addHistory: (item) =>
        set((s) => ({
          history: [item, ...s.history].slice(0, 50),
        })),
      updateHistory: (taskId, patch) =>
        set((s) => ({
          history: s.history.map((h) =>
            h.taskId === taskId ? { ...h, ...patch } : h
          ),
        })),
      clearHistory: () => set({ history: [] }),

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
    }
  )
);

// 从持久化 store 同步配置到 Engine
export function syncConfigToEngine(syncFn: (agents: Agent[], models: ModelConfig[]) => void) {
  const { agents, models } = useAppStore.getState();
  syncFn(agents, models);
}

// 订阅 store 变化，自动同步给 Engine
export function subscribeConfigSync(syncFn: (agents: Agent[], models: ModelConfig[]) => void) {
  return useAppStore.subscribe((state, prevState) => {
    if (state.agents !== prevState.agents || state.models !== prevState.models) {
      syncFn(state.agents, state.models);
    }
  });
}
