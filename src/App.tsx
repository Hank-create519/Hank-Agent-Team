import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './ui/components/Sidebar';
import Dashboard from './ui/pages/Dashboard';
import PipelineView from './ui/pages/PipelineView';
import AgentsPanel from './ui/pages/AgentsPanel';
import ReviewDetail from './ui/pages/ReviewDetail';
import MonitorPage from './ui/pages/MonitorPage';
import { useKeyboard } from './ui/hooks/useKeyboard';
import { PipelineState, PipelineStage, ModelConfig, Agent } from './core/types';
import {
  createInitialState,
} from './core/Pipeline';
import {
  subscribe,
  getState,
  syncFromApp,
  startPipeline,
  pause,
  resume,
  stop,
} from './core/Engine';
import { useAppStore, subscribeConfigSync } from './store/appStore';
import type { HistoryItem } from './store/appStore';

// ==========================================================================
// Hook: engine state -> React
// ==========================================================================
const useEngineState = () => {
  const [state, setState] = useState<PipelineState>(createInitialState());

  useEffect(() => {
    const { agents, models } = useAppStore.getState();
    syncFromApp({ ...state, agents, models });

    const unsubscribe = subscribe(() => {
      setState(getState());
    });

    const unsubStore = subscribeConfigSync((agents, models) =>
      syncFromApp({ ...getState(), agents, models }),
    );

    return () => {
      unsubscribe();
      unsubStore();
    };
  }, []);

  return state;
};

// ==========================================================================
// Types
// ==========================================================================
type Page = 'dashboard' | 'pipeline' | 'review' | 'monitor' | 'agents';

const TAB_LABELS: Record<Page, string> = {
  dashboard: '总览',
  pipeline: '流水线',
  review: '审查详情',
  monitor: '监控',
  agents: '团队',
};

// ==========================================================================
// App — Codex-style layout
// ==========================================================================
const App: React.FC = () => {
  const [page, setPage] = useState<Page>('dashboard');
  const pipeline = useEngineState();
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'review' | 'monitor' | 'agents'>('review');
  const [inputValue, setInputValue] = useState('');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

  // ===== P0-4: Batch queue =====
  const [batchQueue, setBatchQueue] = useState<Array<{
    id: string;
    userInput: string;
    status: 'queued' | 'running' | 'done' | 'failed';
  }>>([]);
  const batchRef = React.useRef(false);

  const processNextBatch = useCallback(() => {
    setBatchQueue((prev) => {
      const nextQueued = prev.find((b) => b.status === 'queued');
      if (!nextQueued) {
        batchRef.current = false;
        return prev;
      }
      const updated = prev.map((b) =>
        b.id === nextQueued.id ? { ...b, status: 'running' as const } : b
      );
      // Start next batch item
      const store = useAppStore.getState();
      startPipeline(nextQueued.userInput);
      const origUnsub = subscribe(() => {
        const s = getState();
        if (!s.isRunning && s.taskId) {
          const report = s.reviewFramework?.finalReport;
          store.addHistory({
            taskId: s.taskId,
            userInput: s.userInput,
            difficulty: s.difficulty,
            reviewAuditCount: s.reviewAuditCount,
            contentRejectCount: s.contentRejectCount,
            codeRejectCount: s.codeRejectCount,
            success: s.errors.length === 0,
            createdAt: new Date().toISOString(),
            summary: s.stageOutputs.done?.summary || '任务完成',
            reviewReport: report || null,
            verdict: report?.verdict || undefined,
            issues: report?.issues?.map((i: any) => ({ severity: i.severity, desc: i.desc })) || undefined,
            suggestions: report?.suggestions || undefined,
            pros: report?.pros || undefined,
          });
          origUnsub();
          // P1-7: Desktop notification on review complete
          try {
            const taskSummary = s.stageOutputs.done?.summary || '任务完成';
            const verdict = report?.verdict;
            const verdictLabel = verdict === 'pass' ? '通过' : verdict === 'conditional' ? '有条件通过' : verdict === 'reject' ? '拒绝' : '完成';
            new Notification(`审查完成 - ${taskSummary}`, {
              body: `结果: ${verdictLabel} | 问题: ${report?.issues?.length || 0} 个`,
            });
          } catch (_) { /* Notification API not available */ }
          // Mark done and process next
          setBatchQueue((prev2) => {
            const done = prev2.map((b) =>
              b.id === nextQueued.id
                ? { ...b, status: (s.stage === 'done' && s.errors.length === 0 ? 'done' : 'failed') as 'done' | 'failed' }
                : b
            );
            return done;
          });
          // Trigger next
          setTimeout(() => processNextBatch(), 500);
        }
      });
      return updated;
    });
  }, []);

  const handleStartBatch = useCallback((inputs: string[]) => {
    if (inputs.length === 0) return;
    const batchItems = inputs.map((input) => ({
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userInput: input,
      status: 'queued' as const,
    }));
    setBatchQueue((prev) => [...prev, ...batchItems]);
    if (!batchRef.current) {
      batchRef.current = true;
      // Start first item after state update
      setTimeout(() => processNextBatch(), 100);
    }
  }, [processNextBatch]);

  const navigate = useCallback((p: string) => {
    setPage(p as Page);
    if (p !== 'review') setSelectedHistoryItem(null);
  }, []);

  const handleSelectHistory = useCallback((item: HistoryItem) => {
    setSelectedHistoryItem(item);
    setPage('review');
  }, []);

  const togglePause = useCallback(() => {
    if (pipeline.paused) resume();
    else pause();
  }, [pipeline.paused]);

  // ===== Config sync helpers =====
  const syncEngine = useCallback(
    (agents: Agent[], models: ModelConfig[]) => {
      syncFromApp({ ...getState(), agents, models });
    },
    [],
  );

  const handleSwitchModel = useCallback(
    (agentId: string, modelId: string) => {
      useAppStore.getState().switchAgentModel(agentId, modelId);
      const { agents } = useAppStore.getState();
      syncEngine(agents, pipeline.models);
    },
    [pipeline.models, syncEngine],
  );

  const handleAddModel = useCallback(
    (config: ModelConfig) => {
      useAppStore.getState().addModel(config);
      const { models } = useAppStore.getState();
      syncEngine(pipeline.agents, models);
    },
    [pipeline.agents, syncEngine],
  );

  const handleRemoveModel = useCallback(
    (modelId: string) => {
      const inUse = pipeline.agents.some((a) => a.model === modelId);
      if (inUse) return;
      useAppStore.getState().removeModel(modelId);
      const { models } = useAppStore.getState();
      syncEngine(pipeline.agents, models);
    },
    [pipeline.agents, syncEngine],
  );

  const handleUpdateModel = useCallback(
    (modelId: string, updates: Partial<ModelConfig>) => {
      useAppStore.getState().updateModel(modelId, updates);
      const { models } = useAppStore.getState();
      syncEngine(pipeline.agents, models);
    },
    [pipeline.agents, syncEngine],
  );

  const handleAddAgent = useCallback(
    (agent: Agent) => {
      useAppStore.getState().addAgent(agent);
      const { agents } = useAppStore.getState();
      syncEngine(agents, pipeline.models);
    },
    [pipeline.models, syncEngine],
  );

  const handleRemoveAgent = useCallback(
    (agentId: string) => {
      useAppStore.getState().removeAgent(agentId);
      const { agents } = useAppStore.getState();
      syncEngine(agents, pipeline.models);
    },
    [pipeline.models, syncEngine],
  );

  const handleUpdateAgent = useCallback(
    (agentId: string, updates: Partial<Agent>) => {
      useAppStore.getState().updateAgent(agentId, updates);
      const { agents } = useAppStore.getState();
      syncEngine(agents, pipeline.models);
    },
    [pipeline.models, syncEngine],
  );

  // P1-8: Keyboard shortcuts
  const handleSubmitInput = () => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea && textarea.value.trim()) {
      // Dispatch Enter key event on textarea to trigger form submit
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  };
  const { commandPalette } = useKeyboard({
    onSubmitInput: handleSubmitInput,
    onToggleRightPanel: () => setRightPanelOpen((p) => !p),
    onClosePanel: () => setRightPanelOpen(false),
    onNavigatePage: (idx) => {
      const pages: Page[] = ['dashboard', 'pipeline', 'review', 'monitor', 'agents'];
      if (pages[idx]) navigate(pages[idx]);
    },
  });

  // ===== Submit =====
  const handleStartPipeline = (userInput: string) => {
    if (!userInput.trim()) return;
    const store = useAppStore.getState();

    const origUnsub = subscribe(() => {
      const s = getState();
      if (!s.isRunning && s.taskId && s.stage === 'done') {
        const report = s.reviewFramework?.finalReport;
        store.addHistory({
          taskId: s.taskId,
          userInput: s.userInput,
          difficulty: s.difficulty,
          reviewAuditCount: s.reviewAuditCount,
          contentRejectCount: s.contentRejectCount,
          codeRejectCount: s.codeRejectCount,
          success: s.errors.length === 0,
          createdAt: new Date().toISOString(),
          summary: s.stageOutputs.done?.summary || '任务完成',
          reviewReport: report || null,
          verdict: report?.verdict || undefined,
          issues: report?.issues?.map((i: any) => ({
            severity: i.severity,
            desc: i.desc,
          })) || undefined,
          suggestions: report?.suggestions || undefined,
          pros: report?.pros || undefined,
        });
        origUnsub();
        // P1-7: Desktop notification
        try {
          const verdict = report?.verdict;
          const verdictLabel = verdict === 'pass' ? '通过' : verdict === 'conditional' ? '有条件通过' : verdict === 'reject' ? '拒绝' : '完成';
          new Notification(`审查完成 - ${s.stageOutputs.done?.summary || s.taskId}`, {
            body: `结果: ${verdictLabel} | 问题: ${report?.issues?.length || 0} 个`,
          });
        } catch (_) { /* ignore */ }
      }
      if (!getState().isRunning && getState().errors.length > 0 && getState().taskId) {
        origUnsub();
      }
    });
    startPipeline(userInput);
    setInputValue('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStartPipeline(inputValue);
    }
  };

  // ===== Render page content =====
  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard pipeline={pipeline} onNavigate={navigate} onStartPipeline={handleStartPipeline} batchQueue={batchQueue} onStartBatch={handleStartBatch} />;
      case 'pipeline':
        return (
          <PipelineView pipeline={pipeline} onStageChange={() => {}} onTogglePause={togglePause} />
        );
      case 'review':
        return <ReviewDetail pipeline={pipeline} historyItem={selectedHistoryItem || undefined} />;
      case 'monitor':
        return <MonitorPage pipeline={pipeline} />;
      case 'agents':
        return (
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
        );
      default:
        return null;
    }
  };

  // ===== Right panel content =====
  const renderRightPanel = () => {
    if (!rightPanelOpen) return null;
    return (
      <div
        style={{
          width: 320,
          minWidth: 320,
          height: '100vh',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 40,
        }}
      >
        {/* Tab Header */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            padding: '0 12px',
            gap: 0,
          }}
        >
          {(['review', 'monitor', 'agents'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setRightPanelTab(tab)}
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: rightPanelTab === tab ? 600 : 400,
                color: rightPanelTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: 'none',
                borderBottom: rightPanelTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 120ms',
              }}
            >
              {tab === 'review' ? '审查' : tab === 'monitor' ? '监控' : 'Agent'}
            </button>
          ))}
          <button
            onClick={() => setRightPanelOpen(false)}
            style={{
              marginLeft: 'auto',
              padding: '10px 8px',
              fontSize: 14,
              color: 'var(--text-tertiary)',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            &times;
          </button>
        </div>

        {/* Panel Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontSize: 13 }}>
          {rightPanelTab === 'review' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                当前阶段
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-input)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 16,
                }}
              >
                {pipeline.stage === 'done'
                  ? '已完成'
                  : pipeline.isRunning
                  ? `运行中 · ${pipeline.stage}`
                  : '待机'}
              </div>

              {pipeline.reviewFramework?.finalReport && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                    审查报告
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <div style={{ marginBottom: 6 }}>
                      判定：
                      <span
                        style={{
                          fontWeight: 600,
                          color:
                            pipeline.reviewFramework.finalReport.verdict === 'pass'
                              ? 'var(--accent-green)'
                              : pipeline.reviewFramework.finalReport.verdict === 'reject'
                              ? 'var(--accent-orange)'
                              : 'var(--accent)',
                        }}
                      >
                        {pipeline.reviewFramework.finalReport.verdict === 'pass'
                          ? '通过'
                          : pipeline.reviewFramework.finalReport.verdict === 'reject'
                          ? '驳回'
                          : '有条件通过'}
                      </span>
                    </div>
                    {pipeline.reviewFramework.finalReport.issues.length > 0 && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>问题列表：</div>
                        {pipeline.reviewFramework.finalReport.issues.map((issue, i) => (
                          <div
                            key={i}
                            style={{
                              padding: '4px 8px',
                              marginBottom: 4,
                              borderRadius: 4,
                              background: 'var(--bg-card-hover)',
                              fontSize: 11,
                              color:
                                issue.severity === 'high'
                                  ? 'var(--accent-orange)'
                                  : issue.severity === 'medium'
                                  ? 'var(--accent)'
                                  : 'var(--text-tertiary)',
                            }}
                          >
                            [{issue.severity}] {issue.desc}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {!pipeline.reviewFramework?.finalReport && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                  暂无审查数据。启动一次审查后这里会显示结果。
                </div>
              )}
            </div>
          )}

          {rightPanelTab === 'monitor' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                最近事件
              </div>
              {pipeline.monitorEvents && pipeline.monitorEvents.length > 0 ? (
                pipeline.monitorEvents.slice(-20).reverse().map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 8px',
                      marginBottom: 4,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>{ev.time}</span>
                    <span style={{ fontWeight: 500 }}>{ev.agentName}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}> · {ev.content.slice(0, 80)}</span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>暂无监控事件</div>
              )}
            </div>
          )}

          {rightPanelTab === 'agents' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
                Agent 状态
              </div>
              {pipeline.agents.length > 0 ? (
                pipeline.agents.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      marginBottom: 4,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          a.status === 'running'
                            ? 'var(--accent-green)'
                            : a.status === 'error'
                            ? 'var(--accent-orange)'
                            : a.status === 'done'
                            ? 'var(--accent)'
                            : 'var(--text-tertiary)',
                      }}
                    />
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>{a.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      {a.model}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>暂无 Agent</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Drag region */}
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

      {/* SIDEBAR */}
      <Sidebar currentPage={page} onNavigate={navigate} pipeline={pipeline} onSelectHistory={handleSelectHistory} />

      {/* MAIN CONTENT */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: 'var(--bg-root)',
        }}
      >
        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            height: 38,
            borderBottom: '1px solid var(--border)',
            gap: 0,
            flexShrink: 0,
          }}
        >
          {(Object.keys(TAB_LABELS) as Page[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setPage(tab)}
              style={{
                padding: '9px 14px',
                fontSize: 12,
                fontWeight: page === tab ? 600 : 400,
                color: page === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: 'none',
                borderBottom: page === tab ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                transition: 'all 120ms',
                marginBottom: -1,
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
          {/* Right panel toggle */}
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            title="切换面板"
            style={{
              marginLeft: 'auto',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: rightPanelOpen ? 'var(--bg-card-hover)' : 'transparent',
              color: 'var(--text-tertiary)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 120ms',
            }}
          >
            &#9776;
          </button>
        </div>

        {/* Page Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px 24px',
          }}
        >
          {renderPage()}
        </div>

        {/* Input Bar */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            padding: '12px 20px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 10,
              maxWidth: '100%',
            }}
          >
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="描述你的代码审查需求..."
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                minHeight: 36,
                maxHeight: 120,
                padding: '8px 14px',
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: 'var(--font-sans)',
                color: 'var(--text-primary)',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
                transition: 'border-color 150ms',
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {pipeline.isRunning && (
                <>
                  <button
                    onClick={togglePause}
                    title={pipeline.paused ? '恢复' : '暂停'}
                    style={{
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {pipeline.paused ? '\u25B6' : '\u23F8'}
                  </button>
                  <button
                    onClick={() => stop()}
                    title="停止"
                    style={{
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--accent-orange)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    &#9632;
                  </button>
                </>
              )}
              <button
                onClick={() => handleStartPipeline(inputValue)}
                disabled={!inputValue.trim() || pipeline.isRunning}
                title="执行"
                style={{
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background:
                    !inputValue.trim() || pipeline.isRunning
                      ? 'var(--border)'
                      : 'var(--accent)',
                  color: '#fff',
                  fontSize: 14,
                  cursor: !inputValue.trim() || pipeline.isRunning ? 'not-allowed' : 'pointer',
                  transition: 'all 150ms',
                }}
              >
                &rarr;
              </button>
            </div>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              color: 'var(--text-tertiary)',
              textAlign: 'center',
            }}
          >
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      {renderRightPanel()}

      {/* P1-8: Command Palette */}
      {commandPalette}
    </div>
  );
};

export default App;
