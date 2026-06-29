import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './ui/components/Sidebar';
import Dashboard from './ui/pages/Dashboard';
import PipelineView from './ui/pages/PipelineView';
import AgentsPanel from './ui/pages/AgentsPanel';
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

// 引擎状态同步到 React state
const useEngineState = () => {
  const [state, setState] = useState<PipelineState>(createInitialState());

  useEffect(() => {
    // 初始化引擎
    syncFromApp(state);

    // 订阅引擎状态变更
    const unsubscribe = subscribe(() => {
      setState(getState());
    });

    return () => unsubscribe();
  }, []);

  return state;
};

type Page = 'dashboard' | 'pipeline' | 'agents';

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('dashboard');
  const pipeline = useEngineState();

  const setStage = useCallback((stage: PipelineStage, progress: number) => {
    // 不再直接改 state，由 Engine 驱动
  }, []);

  const togglePause = useCallback(() => {
    if (pipeline.paused) {
      resume();
    } else {
      pause();
    }
  }, [pipeline.paused]);

  const handleSwitchModel = useCallback((agentId: string, modelId: string) => {
    // 更新 agents 和 models 后同步给 Engine
    const newState = { ...pipeline, agents: switchAgentModel(pipeline.agents, agentId, modelId) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleAddModel = useCallback((config: ModelConfig) => {
    const newState = { ...pipeline, models: addModel(pipeline.models, config) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleRemoveModel = useCallback((modelId: string) => {
    const inUse = pipeline.agents.some(a => a.model === modelId);
    if (inUse) return;
    const newState = { ...pipeline, models: removeModel(pipeline.models, modelId) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleUpdateModel = useCallback((modelId: string, updates: Partial<ModelConfig>) => {
    const newState = { ...pipeline, models: updateModel(pipeline.models, modelId, updates) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleAddAgent = useCallback((agent: Agent) => {
    const newState = { ...pipeline, agents: addAgent(pipeline.agents, agent) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleRemoveAgent = useCallback((agentId: string) => {
    const newState = { ...pipeline, agents: removeAgent(pipeline.agents, agentId) };
    syncFromApp(newState);
  }, [pipeline]);

  const handleUpdateAgent = useCallback((agentId: string, updates: Partial<Agent>) => {
    const newState = { ...pipeline, agents: updateAgent(pipeline.agents, agentId, updates) };
    syncFromApp(newState);
  }, [pipeline]);

  // 启动流水线
  const handleStartPipeline = (userInput: string) => {
    if (!userInput.trim()) return;
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
          WebkitAppRegion: 'drag',
        }}
      />
      <Sidebar currentPage={page} onNavigate={setPage} pipeline={pipeline} />
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
        {page === 'dashboard' && <Dashboard pipeline={pipeline} onNavigate={setPage} onStartPipeline={handleStartPipeline} />}
        {page === 'pipeline' && (
          <PipelineView pipeline={pipeline} onStageChange={setStage} onTogglePause={togglePause} />
        )}
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
