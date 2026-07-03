import React, { useState, useRef } from 'react';
import { PipelineState, Agent, ModelConfig, Department } from '../../core/types';
import { getModelDisplayName } from '../../core/Pipeline';
import { Plus, X, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

interface AgentsPanelProps {
  pipeline: PipelineState;
  onSwitchModel: (agentId: string, modelId: string) => void;
  onAddModel: (config: ModelConfig) => void;
  onRemoveModel: (modelId: string) => void;
  onUpdateModel: (modelId: string, updates: Partial<ModelConfig>) => void;
  onAddAgent: (agent: Agent) => void;
  onRemoveAgent: (agentId: string) => void;
  onUpdateAgent: (agentId: string, updates: Partial<Agent>) => void;
}

const DEPT_COLORS: Record<Department, string> = {
  command: 'var(--dept-command)',
  info: 'var(--dept-info)',
  develop: 'var(--dept-develop)',
  review: 'var(--dept-review)',
};
const DEPT_NAMES: Record<Department, string> = {
  command: '指挥部',
  info: '信息部',
  develop: '开发部',
  review: '审核部',
};
const STATUS_LABEL: Record<string, string> = {
  idle: '待命',
  running: '执行中',
  waiting: '等待',
  paused: '已暂停',
  done: '完成',
  error: '错误',
};

// =========== 模型注册表（厂商折叠 + 模型展开显示 Agent API） ===========
const ModelRegistry: React.FC<{
  models: ModelConfig[];
  agents: Agent[];
  onAddModel: (config: ModelConfig) => void;
  onRemoveModel: (modelId: string) => void;
  onUpdateAgent: (agentId: string, updates: Partial<Agent>) => void;
}> = ({ models, agents, onAddModel, onRemoveModel, onUpdateAgent }) => {
  const agentsByModel = new Map<string, Agent[]>();
  const [testStatus, setTestStatus] = useState<Record<string, 'testing' | 'ok' | 'fail' | null>>({});
  const [testError, setTestError] = useState<Record<string, string>>({});

  const handleTest = async (agent: Agent, model: ModelConfig) => {
    setTestStatus((prev) => ({ ...prev, [agent.id]: 'testing' }));
    try {
      const baseUrl = agent.baseUrl || 'https://api.openai.com/v1';
      const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agent.apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      if (res.ok) {
        setTestStatus((prev) => ({ ...prev, [agent.id]: 'ok' }));
      } else {
        const text = await res.text();
        setTestStatus((prev) => ({ ...prev, [agent.id]: 'fail' }));
        setTestError((prev) => ({ ...prev, [agent.id]: text.slice(0, 200) }));
      }
    } catch (e: any) {
      setTestStatus((prev) => ({ ...prev, [agent.id]: 'fail' }));
      setTestError((prev) => ({ ...prev, [agent.id]: e.message || 'Network error' }));
    }
  };

  agents.forEach(a => {
    if (!agentsByModel.has(a.model)) agentsByModel.set(a.model, []);
    agentsByModel.get(a.model)!.push(a);
  });

  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set());

  const grouped = new Map<string, ModelConfig[]>();
  models.forEach(m => {
    const p = m.provider || '其他';
    if (!grouped.has(p)) grouped.set(p, []);
    grouped.get(p)!.push(m);
  });

  const toggleProvider = (provider: string) => {
    setCollapsedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  return (
    <div className="glass-card" style={{ padding: 24, marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          模型注册表 & API 管理
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 10 }}>
            {models.length} 模型 · {agents.filter(a => a.apiKey).length} Key 已配
          </span>
        </h3>
        <button onClick={() => setAdding(!adding)} className="btn btn-primary">
          <Plus size={14} style={{ marginRight: 4 }} /> 添加模型
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 150 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>模型 ID</div>
            <input
              placeholder="ernie-4.5"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              className="glass-input"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ width: 150 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>模型名</div>
            <input
              placeholder="ERNIE-4.5"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="glass-input"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ width: 140 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>厂商</div>
            <input
              placeholder="百度文心"
              value={newProvider}
              onChange={e => setNewProvider(e.target.value)}
              className="glass-input"
              style={{ width: '100%' }}
            />
          </div>
          <button
            onClick={() => {
              const id = newId.trim() || newName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
              if (!id || !newName.trim()) return;
              onAddModel({ id, name: newName.trim(), provider: newProvider.trim() || '其他' });
              setNewId('');
              setNewName('');
              setNewProvider('');
              setAdding(false);
            }}
            className="btn btn-primary"
          >
            确认
          </button>
          <button onClick={() => setAdding(false)} className="btn btn-ghost">
            取消
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {Array.from(grouped.entries()).map(([provider, providerModels]) => {
          const isProviderOpen = !collapsedProviders.has(provider);
          return (
            <div key={provider}>
              <button
                onClick={() => toggleProvider(provider)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  borderRadius: 8,
                  textAlign: 'left' as const,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {isProviderOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontWeight: 600 }}>{provider}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{providerModels.length} 模型</span>
              </button>
              {isProviderOpen && (
                <div style={{ paddingLeft: 16 }}>
                  {providerModels.map(m => {
                    const modelAgents = agentsByModel.get(m.id) || [];
                    const isModelOpen = expandedModel === m.id;
                    const hasKey = modelAgents.some(a => a.apiKey);
                    const inUse = modelAgents.length > 0;

                    return (
                      <div key={m.id}>
                        {/* 模型行 */}
                        <button
                          onClick={() => setExpandedModel(isModelOpen ? null : m.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '6px 12px',
                            border: 'none',
                            background: isModelOpen ? 'rgba(255,255,255,0.04)' : 'transparent',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                            fontFamily: 'inherit',
                            borderRadius: 6,
                            textAlign: 'left' as const,
                          }}
                          onMouseEnter={e => {
                            if (!isModelOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          }}
                          onMouseLeave={e => {
                            if (!isModelOpen) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          {isModelOpen ? <ChevronDown size={12} color="var(--text-tertiary)" /> : <ChevronRight size={12} color="var(--text-tertiary)" />}
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: hasKey ? 'var(--accent-green)' : inUse ? 'var(--accent-orange)' : '#444',
                              flexShrink: 0,
                            }}
                          />
                          <span>{m.name}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                            {m.id}
                          </span>
                          {inUse ? (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                borderRadius: 10,
                                background: hasKey ? 'rgba(52,199,89,0.12)' : 'rgba(245,158,11,0.12)',
                                color: hasKey ? 'var(--accent-green)' : 'var(--accent-orange)',
                                marginLeft: 'auto',
                              }}
                            >
                              {modelAgents.length} Agent {!hasKey && '· 未配 Key'}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>未使用</span>
                          )}
                          {!inUse && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                onRemoveModel(m.id);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                opacity: 0.4,
                                padding: 2,
                                color: 'var(--text-tertiary)',
                              }}
                              title="删除模型"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </button>

                        {/* 展开：每个使用该模型的 Agent 独立配 API */}
                        {isModelOpen && inUse && (
                          <div style={{ paddingLeft: 28, paddingBottom: 8 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', margin: '6px 0 8px 0', fontWeight: 500 }}>
                              使用此模型的 Agent — 各自独立配置 API Key
                            </div>
                            {modelAgents.map(agent => (
                              <div
                                key={agent.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '6px 12px',
                                  borderRadius: 6,
                                  background: 'rgba(255,255,255,0.015)',
                                  marginBottom: 4,
                                  border: '1px solid rgba(255,255,255,0.03)',
                                }}
                              >
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: 4,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: `${DEPT_COLORS[agent.department]}15`,
                                    border: `1px solid ${DEPT_COLORS[agent.department]}30`,
                                    color: DEPT_COLORS[agent.department],
                                    flexShrink: 0,
                                  }}
                                >
                                  {agent.name.slice(0, 1)}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-primary)', width: 80, flexShrink: 0 }}>
                                  {agent.name}
                                </span>
                                <span style={{ fontSize: 10, color: DEPT_COLORS[agent.department], width: 50, flexShrink: 0 }}>
                                  {DEPT_NAMES[agent.department]}
                                </span>
                                <div style={{ flex: 1 }}>
                                  <input
                                    type="password"
                                    placeholder="API Key (sk-...)"
                                    value={agent.apiKey}
                                    onChange={e => onUpdateAgent(agent.id, { apiKey: e.target.value })}
                                    className="glass-input"
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <button
                                  onClick={() => handleTest(agent, m)}
                                  disabled={!agent.apiKey || testStatus[agent.id] === 'testing'}
                                  title={testError[agent.id] || ''}
                                  style={{
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    border: '1px solid var(--border)',
                                    background: testStatus[agent.id] === 'ok' ? 'rgba(34,197,94,0.15)' : testStatus[agent.id] === 'fail' ? 'rgba(239,68,68,0.15)' : 'transparent',
                                    color: testStatus[agent.id] === 'ok' ? 'var(--accent-green)' : testStatus[agent.id] === 'fail' ? 'var(--accent-red)' : 'var(--accent)',
                                    fontSize: 11,
                                    cursor: agent.apiKey ? 'pointer' : 'not-allowed',
                                    fontFamily: 'inherit',
                                    flexShrink: 0,
                                    minWidth: 44,
                                  }}
                                >
                                  {testStatus[agent.id] === 'testing' ? (
                                    <span style={{ display: 'inline-block', animation: 'spin 0.6s linear infinite' }}>⟳</span>
                                  ) : testStatus[agent.id] === 'ok' ? '✓' : testStatus[agent.id] === 'fail' ? '✗' : '测试'}
                                </button>
                                <div style={{ flex: 1, maxWidth: 200 }}>
                                  <input
                                    placeholder="Base URL (可选)"
                                    value={agent.baseUrl}
                                    onChange={e => onUpdateAgent(agent.id, { baseUrl: e.target.value })}
                                    className="glass-input"
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =========== Agent 卡片 ===========
const AgentCard: React.FC<{
  agent: Agent;
  color: string;
  models: ModelConfig[];
  departmentAgents: Agent[];
  isLastAgent: boolean;
  onSwitchModel: (agentId: string, modelId: string) => void;
  onRemoveAgent: (agentId: string) => void;
  onUpdateAgent: (agentId: string, updates: Partial<Agent>) => void;
}> = ({
  agent,
  color,
  models,
  departmentAgents,
  isLastAgent,
  onSwitchModel,
  onRemoveAgent,
  onUpdateAgent,
}) => {
  const [dropdown, setDropdown] = useState(false);
  const [skillInput, setSkillInput] = useState('');
  const name = getModelDisplayName(models, agent.model);

  const addSkill = (skill: string) => {
    const s = skill.trim();
    if (!s || agent.skills.includes(s)) return;
    onUpdateAgent(agent.id, { skills: [...agent.skills, s] });
    setSkillInput('');
  };

  const removeSkill = (skill: string) => {
    onUpdateAgent(agent.id, { skills: agent.skills.filter(sk => sk !== skill) });
  };

  return (
    <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 第一行：名称 + 角色 + 模型 + 状态 + 删除 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${color}15`,
            border: `1px solid ${color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color,
            flexShrink: 0,
          }}
        >
          {agent.name.slice(0, 2)}
        </div>
        <input
          value={agent.name}
          onChange={e => onUpdateAgent(agent.id, { name: e.target.value })}
          className="glass-input"
          style={{ width: 100, padding: '4px 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', borderColor: 'rgba(255,255,255,0.06)', background: 'transparent' }}
        />

        <select
          value={agent.role}
          onChange={e => {
            const newRole = e.target.value as 'leader' | 'member';
            if (newRole === 'leader') {
              const oldLeader = departmentAgents.find(a => a.role === 'leader' && a.id !== agent.id);
              if (oldLeader) onUpdateAgent(oldLeader.id, { role: 'member' });
            }
            onUpdateAgent(agent.id, { role: newRole });
          }}
          style={{
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.3)',
            color: agent.role === 'leader' ? 'var(--accent-orange)' : 'var(--text-tertiary)',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <option value="leader" style={{ color: 'var(--accent-orange)', background: '#0a0a1a' }}>
            队长
          </option>
          <option value="member" style={{ color: 'var(--text-tertiary)', background: '#0a0a1a' }}>
            成员
          </option>
        </select>

        {/* 模型选择 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setDropdown(!dropdown)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {name} <ChevronDown size={12} color="var(--text-tertiary)" />
          </button>
          {dropdown && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setDropdown(false)} />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: '#111127',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  padding: 4,
                  zIndex: 50,
                  minWidth: 240,
                  maxHeight: 340,
                  overflow: 'auto',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                }}
              >
                {models.map(m => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSwitchModel(agent.id, m.id);
                      setDropdown(false);
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: m.id === agent.model ? 'rgba(77,171,247,0.12)' : 'transparent',
                      color: m.id === agent.model ? 'var(--accent)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    <span>{m.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{m.provider}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span
            className="status-dot"
            style={{
              background:
                agent.status === 'running'
                  ? 'var(--accent-green)'
                  : agent.status === 'error'
                  ? 'var(--accent-red)'
                  : agent.status === 'waiting' || agent.status === 'paused'
                  ? 'var(--accent-orange)'
                  : 'var(--text-tertiary)',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {STATUS_LABEL[agent.status] ?? '待命'}
          </span>
        </div>

        <button
          onClick={() => onRemoveAgent(agent.id)}
          disabled={isLastAgent}
          style={{
            background: 'none',
            border: 'none',
            cursor: isLastAgent ? 'not-allowed' : 'pointer',
            opacity: isLastAgent ? 0.3 : 1,
            padding: '4px 6px',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
          title={isLastAgent ? '部门至少保留一个 Agent' : '删除此 Agent'}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* 提示词 */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 500 }}>
          System Prompt
        </div>
        <textarea
          value={agent.systemPrompt}
          onChange={e => onUpdateAgent(agent.id, { systemPrompt: e.target.value })}
          rows={2}
          placeholder="设定该 Agent 的行为、职责和回复风格..."
          className="glass-input"
          style={{ resize: 'vertical', minHeight: 44, padding: '8px 10px', lineHeight: 1.5 }}
        />
      </div>

      {/* 技能 */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 500 }}>
          Skills
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {agent.skills.map(s => (
            <span
              key={s}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(77,171,247,0.12)',
                color: 'var(--accent)',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {s}
              <button
                onClick={() => removeSkill(s)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1,
                  marginLeft: 2,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="输入技能后按回车添加..."
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addSkill(skillInput);
            }}
            className="glass-input"
            style={{ width: 220, padding: '4px 8px', fontSize: 11 }}
          />
          <button onClick={() => addSkill(skillInput)} className="btn btn-primary" style={{ fontSize: 11, padding: '4px 10px' }}>
            添加
          </button>
        </div>
      </div>

      {/* 统计 */}
      {agent.stats.tasksCompleted > 0 && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-tertiary)', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span>完成: {agent.stats.tasksCompleted}</span>
          <span>错误: {agent.stats.errors}</span>
          <span>平均: {agent.stats.avgTime}s</span>
        </div>
      )}
    </div>
  );
};

// =========== 审查规则 Tab (P1-5) ===========
const DEFAULT_AGENTS_RULES = `## Review Guidelines
- Flag SQL injection vulnerabilities as P0 issues
- Flag missing input validation as P1 issues
- Flag hardcoded credentials as P0 issues
- Don't log PII in error messages
- Verify authentication middleware wraps every route`;

const STORAGE_KEY = 'hank_agents_md_rules';

const ReviewRulesTab: React.FC = () => {
  const [rules, setRules] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_AGENTS_RULES;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, rules);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setRules(DEFAULT_AGENTS_RULES);
    localStorage.setItem(STORAGE_KEY, DEFAULT_AGENTS_RULES);
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          审查规则配置
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          以 AGENTS.md 格式定义审查规则，引擎在执行审查时将读取这些规则。
        </p>
      </div>
      <textarea
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        rows={16}
        style={{
          width: '100%', padding: '14px 16px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg-input)',
          color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)',
          resize: 'vertical', lineHeight: 1.7, minHeight: 280,
        }}
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          onClick={handleSave}
          className="btn btn-primary"
          style={{ fontSize: 13, padding: '8px 20px' }}
        >
          {saved ? '已保存' : '保存'}
        </button>
        <button
          onClick={handleReset}
          className="btn btn-secondary"
          style={{ fontSize: 13, padding: '8px 20px' }}
        >
          重置为默认
        </button>
      </div>
    </div>
  );
};

// =========== 主页面 ===========
const AgentsPanel: React.FC<AgentsPanelProps> = ({
  pipeline,
  onSwitchModel,
  onAddModel,
  onRemoveModel,
  onUpdateModel,
  onAddAgent,
  onRemoveAgent,
  onUpdateAgent,
}) => {
  const agents = pipeline.agents;
  const models = pipeline.models;
  const [activeTab, setActiveTab] = useState<'agents' | 'rules'>('agents');

  const nextIdRef = useRef(1);
  const genId = (dept: Department) => {
    const ids = agents.filter(a => a.department === dept).map(a => a.id);
    while (ids.includes(`${dept}-${nextIdRef.current}`)) nextIdRef.current++;
    return `${dept}-${nextIdRef.current++}`;
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Tab 导航 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Agent 团队
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            {agents.length} Agent · {models.length} 模型 · {agents.filter(a => a.role === 'leader').length} 队长 · {agents.filter(a => a.apiKey).length} Key 已配
          </span>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-input)', borderRadius: 8, padding: 3 }}>
            {[
              { id: 'agents' as const, label: '模型注册' },
              { id: 'rules' as const, label: '审查规则' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: activeTab === tab.id ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 150ms',
                  fontFamily: 'inherit',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'rules' ? (
        <ReviewRulesTab />
      ) : (
        <>
          <ModelRegistry
            models={models}
            agents={agents}
            onAddModel={onAddModel}
            onRemoveModel={onRemoveModel}
            onUpdateAgent={onUpdateAgent}
          />
          {(['command', 'info', 'develop', 'review'] as Department[]).map(dept => {
        const deptAgents = agents.filter(a => a.department === dept);
        const color = DEPT_COLORS[dept];
        const leader = deptAgents.find(a => a.role === 'leader');

        return (
          <div key={dept} style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}40` }} />
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{DEPT_NAMES[dept]}</span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>({deptAgents.length})</span>
                {leader && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>· 队长: {leader.name}</span>}
              </div>
              <button
                onClick={() => {
                  const id = genId(dept);
                  const defaultModel = models.find(m => m.provider === '腾讯混元')?.id || models[0]?.id || '';
                  onAddAgent({
                    id,
                    name: `${dept === 'command' ? '指挥' : dept === 'info' ? '信息' : dept === 'develop' ? '开发' : '审核'}${nextIdRef.current - 1}`,
                    department: dept,
                    model: defaultModel,
                    apiKey: '',
                    baseUrl: '',
                    role: 'member',
                    status: 'idle',
                    currentTask: '',
                    systemPrompt: '',
                    skills: [],
                    stats: { tasksCompleted: 0, errors: 0, avgTime: 0 },
                  });
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px dashed var(--border)',
                  background: 'transparent',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                <Plus size={14} /> 添加 Agent
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {deptAgents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  color={color}
                  models={models}
                  departmentAgents={deptAgents}
                  isLastAgent={deptAgents.length <= 1}
                  onSwitchModel={onSwitchModel}
                  onRemoveAgent={onRemoveAgent}
                  onUpdateAgent={onUpdateAgent}
                />
              ))}
            </div>
          </div>
        );
      })}
        </>
      )}
    </div>
  );
};

export default AgentsPanel;
