import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './ui/components/Sidebar';
import Dashboard from './ui/pages/Dashboard';
import PipelineView from './ui/pages/PipelineView';
import AgentsPanel from './ui/pages/AgentsPanel';
import ReviewDetail from './ui/pages/ReviewDetail';
import MonitorPage from './ui/pages/MonitorPage';
import { PipelineState, PipelineStage, ModelConfig, Agent } from './core/types';
import {
  createInitialState,
  switchAgentModel,
  addModel,
  removeModel,
  updateModel,
  addAgent,
  removeAgent,
  updateAgent,
} from './core/Pipeline';
import { subscribe, getState, syncFromApp, startPipeline, pause, resume, stop } from './core/Engine';
import { useAppStore, subscribeConfigSync } from './store/appStore';

// 引擎状态同步到 React state
const useEngineState = () => {
  const [state, setState] = useState<PipelineState>(createInitialState());

  useEffect(() => {
    // 启动时从持久化 store 加载配置到引擎
    const { agents, models } = useAppStore.getState();
    syncFromApp({ ...state, agents, models });

    // 订阅引擎状态变更
    const unsubscribe = subscribe(() => {
      setState(getState());
    });

    // 订阅 store 变化，自动同步给 Engine
    const unsubStore = subscribeConfigSync((agents, models) => syncFromApp({ ...getState(), agents, models }));

    return () => { unsubscribe(); unsubStore(); };
  }, []);

  return state;
};

type Page = 'dashboard' | 'pipeline' | 'review' | 'monitor' | 'agents';

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('dashboard');
  const pipeline = useEngineState();

  const navigate = useCallback((p: string) => setPage(p as Page), []);

  const togglePause = useCallback(() => {
    if (pipeline.paused) resume();
    else pause();
  }, [pipeline.paused]);

  // ===== 团队配置操作（同步到 store + engine） =====
  const handleSwitchModel = useCallback((agentId: string, modelId: string) => {
    useAppStore.getState().switchAgentModel(agentId, modelId);
    const { agents } = useAppStore.getState();
    syncFromApp({ ...getState(), agents, models: pipeline.models });
  }, [pipeline.models]);

  const handleAddModel = useCallback((config: ModelConfig) => {
    useAppStore.getState().addModel(config);
    const { models } = useAppStore.getState();
    syncFromApp({ ...getState(), agents: pipeline.agents, models });
  }, [pipeline.agents]);

  const handleRemoveModel = useCallback((modelId: string) => {
    const inUse = pipeline.agents.some(a => a.model === modelId);
    if (inUse) return;
    useAppStore.getState().removeModel(modelId);
    const { models } = useAppStore.getState();
    syncFromApp({ ...getState(), agents: pipeline.agents, models });
  }, [pipeline.agents]);

  const handleUpdateModel = useCallback((modelId: string, updates: Partial<ModelConfig>) => {
    useAppStore.getState().updateModel(modelId, updates);
    const { models } = useAppStore.getState();
    syncFromApp({ ...getState(), agents: pipeline.agents, models });
  }, [pipeline.agents]);

  const handleAddAgent = useCallback((agent: Agent) => {
    useAppStore.getState().addAgent(agent);
    const { agents } = useAppStore.getState();
    syncFromApp({ ...getState(), agents, models: pipeline.models });
  }, [pipeline.models]);

  const handleRemoveAgent = useCallback((agentId: string) => {
    useAppStore.getState().removeAgent(agentId);
    const { agents } = useAppStore.getState();
    syncFromApp({ ...getState(), agents, models: pipeline.models });
  }, [pipeline.models]);

  const handleUpdateAgent = useCallback((agentId: string, updates: Partial<Agent>) => {
    useAppStore.getState().updateAgent(agentId, updates);
    const { agents } = useAppStore.getState();
    syncFromApp({ ...getState(), agents, models: pipeline.models });
  }, [pipeline.models]);

  const handleStartPipeline = (userInput: string) => {
    if (!userInput.trim()) return;
    // 任务结束后存历史
    const origUnsub = subscribe(() => {
      const s = getState();
      if (!s.isRunning && s.taskId && s.stage === 'done') {
        useAppStore.getState().addHistory({
          taskId: s.taskId,
          userInput: s.userInput,
          difficulty: s.difficulty,
          reviewAuditCount: s.reviewAuditCount,
          contentRejectCount: s.contentRejectCount,
          codeRejectCount: s.codeRejectCount,
          success: s.errors.length === 0,
          createdAt: new Date().toISOString(),
          summary: s.stageOutputs.done?.summary || '任务完成',
        });
        origUnsub();
      }
      if (!getState().isRunning && getState().errors.length > 0 && getState().taskId) {
        origUnsub();
      }
    });
    startPipeline(userInput);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 38,
          zIndex: 100,
          ...({ WebkitAppRegion: 'drag' } as React.CSSProperties),
        }}
      />
      <Sidebar currentPage={page} onNavigate={navigate} pipeline={pipeline} />
      <main
        style={{
          flex: 1,
          marginLeft: 56,
          overflow: 'auto',
          padding: '38px 32px 24px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {page === 'dashboard' && <Dashboard pipeline={pipeline} onNavigate={navigate} onStartPipeline={handleStartPipeline} />}
        {page === 'pipeline' && (
          <PipelineView pipeline={pipeline} onStageChange={() => {}} onTogglePause={togglePause} />
        )}
        {page === 'review' && <ReviewDetail pipeline={pipeline} />}
        {page === 'monitor' && <MonitorPage pipeline={pipeline} />}
        {page === 'agents' && (
          <AgentsPanel
            pipeline={pipeline}
            onSwitchModel={handleSwitchModel}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
            onUpdateModel={handleUpdateModel}
            onAddAgent={handleAddAgent}
            onRemoveAgent={handleRemoveAgent}
            onUpdateAgent={handleUpdateAgent}
          />
        )}
      </main>
    </div>
  );
};

export default App;
