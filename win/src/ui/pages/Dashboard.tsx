import React, { useState } from 'react';
import { PipelineState } from '../../core/types';
import {
  Activity, ArrowUpRight, Eye, Gauge, GitBranch, Play,
  ShieldCheck, Users, Box, Rocket, Sparkles, Clock3, CheckCircle2,
} from 'lucide-react';
import { STAGE_PROGRESS_FULL } from '../../core/Pipeline';
import ReviewTemplates from '../components/ReviewTemplates';
import StatsPanel from '../components/StatsPanel';
import GitPanel from '../components/GitPanel';
import { useAppStore } from '../../store/appStore';
import type { HistoryItem } from '../../store/appStore';

interface DashboardProps {
  pipeline: PipelineState;
  onNavigate: (page: string) => void;
  onStartPipeline: (userInput: string) => void;
  onSelectHistory?: (item: HistoryItem) => void;
  batchQueue?: Array<{ id: string; userInput: string; status: 'queued' | 'running' | 'done' | 'failed' }>;
  onStartBatch?: (inputs: string[]) => void;
}

const STAGE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  difficulty_assess: { label: '难度评估', icon: Gauge },
  init: { label: '制定方案', icon: Activity },
  audit_entry: { label: '审查框架把关', icon: ShieldCheck },
  extract: { label: '信息提取', icon: Box },
  content_review: { label: '内容审核', icon: ShieldCheck },
  develop: { label: '开发编码', icon: Play },
  code_review: { label: '代码审核', icon: ShieldCheck },
  deep_audit: { label: '系统级深度审计', icon: ShieldCheck },
  deploy: { label: '部署说明', icon: Rocket },
  done: { label: '完成', icon: CheckCircle2 },
};

const PRESET_PROMPTS = [
  { title: '审查代码安全性', detail: '从权限、输入和数据边界开始', text: '请审查项目中的身份验证与权限控制，重点检查越权访问、输入校验和敏感信息处理，并按风险给出可执行的修复建议。' },
  { title: '排查构建问题', detail: '定位原因并整理修复步骤', text: '请分析当前项目可能的构建失败原因，结合依赖、配置和代码结构，给出可验证的排查顺序与修复建议。' },
  { title: '梳理模块改造', detail: '先拆清影响范围与实施计划', text: '请梳理需要改造模块的职责、依赖关系和潜在风险，制定分阶段实施计划，并说明每阶段的验收方式。' },
];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};

const Dashboard: React.FC<DashboardProps> = ({
  pipeline, onNavigate, onStartPipeline, onSelectHistory, batchQueue = [], onStartBatch,
}) => {
  const history = useAppStore((store) => store.history);
  const activeAgents = pipeline.agents.filter((agent) => agent.status === 'running').length;
  const idleAgents = pipeline.agents.filter((agent) => agent.status === 'idle').length;
  const errorAgents = pipeline.agents.filter((agent) => agent.status === 'error').length;
  const currentStage = STAGE_LABELS[pipeline.stage] || STAGE_LABELS.difficulty_assess;
  const StageIcon = currentStage.icon;
  const progress = pipeline.progress > 0 ? pipeline.progress : (STAGE_PROGRESS_FULL[pipeline.stage] ?? 0);
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const busy = isSubmitting || pipeline.isRunning;
  const recentHistory = history.slice(0, 5);
  const queuedCount = batchQueue.filter((item) => item.status === 'queued').length;
  const completedCount = batchQueue.filter((item) => item.status === 'done').length;

  const handleSubmit = async () => {
    if (!userInput.trim() || busy) return;
    setIsSubmitting(true);
    if (isBatchMode && onStartBatch) {
      const lines = userInput.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) onStartBatch(lines);
      else onStartPipeline(userInput);
    } else {
      onStartPipeline(userInput);
    }
    setUserInput('');
    onNavigate('pipeline');
    setIsSubmitting(false);
  };

  const outcomeLabel = (item: HistoryItem) => {
    if (item.demoUsed || item.outcome === 'demo') return '演示结果';
    if (item.outcome === 'incomplete' || item.outcome === 'cancelled') return '未完成';
    if (item.outcome === 'failed' || item.success === false) return '执行失败';
    return '已完成';
  };
  const outcomeClass = (item: HistoryItem) => {
    if (item.demoUsed || item.outcome === 'demo') return 'studio-outcome-demo';
    if (item.outcome === 'incomplete' || item.outcome === 'cancelled' || item.outcome === 'failed' || !item.success) return 'studio-outcome-incomplete';
    return 'studio-outcome-complete';
  };

  return (
    <main className="studio-dashboard">
      <header className="studio-heading animate-fade-up">
        <div className="studio-heading-copy">
          <div className="studio-eyebrow"><span className="studio-eyebrow-mark"><Sparkles size={13} /></span> HANK AGENT TEAM <span className="studio-eyebrow-divider">/</span> 工作台</div>
          <h1>从一个想法，开始协作。</h1>
          <p>把目标和背景交给团队，过程、审查与结果都在这里跟进。</p>
        </div>
        <div className={'studio-live-pill ' + (pipeline.isRunning ? 'is-running' : errorAgents ? 'has-errors' : 'is-ready')}>
          <span className="studio-live-dot" />
          {pipeline.isRunning ? '团队正在执行' : errorAgents ? errorAgents + ' 个 Agent 需要关注' : '团队已就绪'}
        </div>
      </header>

      <div className="studio-grid">
        <section className="studio-main-column">
          <section className="studio-composer glass-card">
            <div className="studio-composer-top">
              <div>
                <div className="studio-section-label">开始一项新任务</div>
                <h2>这次要解决什么问题？</h2>
                <p>写下目标、相关背景和限制条件。你可以先选一个示例再按需修改。</p>
              </div>
              <div className="studio-composer-tools">
                <ReviewTemplates onSelectTemplate={(template) => setUserInput(template)} />
                <GitPanel onStartReview={onStartPipeline} />
              </div>
            </div>
            <textarea
              id="user-input"
              className="studio-textarea"
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              placeholder={isBatchMode ? '每行输入一个任务，例如：\n检查认证模块的安全性\n优化列表页的加载性能' : '描述希望团队完成的工作，以及需要特别关注的细节…'}
              rows={isBatchMode ? 5 : 5}
              aria-label="任务描述"
            />
            <div className="studio-composer-bottom">
              <label className="studio-batch-toggle">
                <input type="checkbox" checked={isBatchMode} onChange={(event) => setIsBatchMode(event.target.checked)} />
                <span className="studio-toggle-track" />
                <span>批量任务</span>
              </label>
              <span className="studio-composer-note">可使用模板，或直接审查 Git 仓库</span>
              <button className="btn btn-primary studio-submit" onClick={handleSubmit} disabled={!userInput.trim() || busy}>
                {busy ? <span className="dot-loader"><span /><span /><span /></span> : <><Play size={14} fill="currentColor" /><span>开始协作</span><ArrowUpRight size={15} /></>}
              </button>
            </div>
          </section>

          <section className="studio-prompt-section">
            <div className="studio-subheading"><span>从这些方向开始</span><span>选择后可继续编辑</span></div>
            <div className="studio-prompt-list">
              {PRESET_PROMPTS.map((prompt, index) => (
                <button key={prompt.title} className="studio-prompt-card" onClick={() => setUserInput(prompt.text)}>
                  <span className="studio-prompt-index">0{index + 1}</span>
                  <span className="studio-prompt-copy"><strong>{prompt.title}</strong><small>{prompt.detail}</small></span>
                  <ArrowUpRight size={15} className="studio-prompt-arrow" />
                </button>
              ))}
            </div>
          </section>

          <section className="studio-workspaces">
            <div className="studio-subheading"><span>工作区</span><span>任务启动后可持续查看</span></div>
            <div className="studio-workspace-links">
              <button onClick={() => onNavigate('pipeline')}><span className="studio-workspace-icon"><GitBranch size={16} /></span><span><strong>任务流程</strong><small>阶段与执行产出</small></span><ArrowUpRight size={14} /></button>
              <button onClick={() => onNavigate('review')}><span className="studio-workspace-icon"><ShieldCheck size={16} /></span><span><strong>审查结果</strong><small>结论与修复建议</small></span><ArrowUpRight size={14} /></button>
              <button onClick={() => onNavigate('monitor')}><span className="studio-workspace-icon"><Eye size={16} /></span><span><strong>团队动态</strong><small>事件与 Agent 活动</small></span><ArrowUpRight size={14} /></button>
            </div>
          </section>

          {batchQueue.length > 0 && (
            <section className="studio-queue-section">
              <div className="studio-subheading"><span>批量任务队列</span><span>{completedCount} / {batchQueue.length} 已完成{queuedCount ? ' · ' + queuedCount + ' 项等待' : ''}</span></div>
              <div className="studio-queue-list glass-card">
                {batchQueue.map((item, index) => {
                  const labels: Record<string, string> = { queued: '排队中', running: '执行中', done: '已完成', failed: '失败' };
                  return <div key={item.id} className={'studio-queue-item queue-item-' + item.status}><span className="studio-queue-index">{String(index + 1).padStart(2, '0')}</span><span className="studio-queue-text" title={item.userInput}>{item.userInput}</span><span className={'studio-queue-status queue-status-' + item.status}>{item.status === 'running' && <span className="queue-status-pulse" />}{labels[item.status]}</span></div>;
                })}
              </div>
            </section>
          )}
        </section>

        <aside className="studio-side-column">
          <section className="studio-team-card glass-card">
            <div className="studio-side-heading"><span className="studio-side-icon"><Users size={15} /></span><div><h2>团队状态</h2><p>当前协作资源</p></div><button onClick={() => onNavigate('agents')} aria-label="打开团队配置" title="团队配置"><ArrowUpRight size={15} /></button></div>
            {pipeline.isRunning ? (
              <div className="studio-stage-card">
                <div className="studio-stage-copy"><span><StageIcon size={14} />{currentStage.label}</span><strong>{progress}%</strong></div>
                <div className="studio-progress-track"><span style={{ width: progress + '%' }} /></div>
                <small>任务执行中 · 可在任务流程中查看详情</small>
              </div>
            ) : (
              <div className="studio-ready-card"><span className="studio-ready-symbol"><CheckCircle2 size={17} /></span><span><strong>{pipeline.stage === 'done' ? '最近一项任务已结束' : '工作区可以开始新任务'}</strong><small>{pipeline.reviewAuditCount > 0 ? '最近审查 ' + pipeline.reviewAuditCount + ' 轮' : '团队成员可随时接手'}</small></span></div>
            )}
            <div className="studio-team-stats">
              <div><span className="studio-agent-dot is-active" /><span>执行中</span><strong>{activeAgents}</strong></div>
              <div><span className="studio-agent-dot is-idle" /><span>待命</span><strong>{idleAgents}</strong></div>
              <div><span className="studio-agent-dot is-error" /><span>需关注</span><strong>{errorAgents}</strong></div>
            </div>
            <button className="studio-team-link" onClick={() => onNavigate('agents')}>管理团队与模型 <ArrowUpRight size={13} /></button>
          </section>

          <section className="studio-history-card glass-card">
            <div className="studio-side-heading"><span className="studio-side-icon"><Clock3 size={15} /></span><div><h2>最近任务</h2><p>{history.length ? '可打开记录查看审查详情' : '任务完成后会保存在这里'}</p></div></div>
            {recentHistory.length ? (
              <div className="studio-recent-list">
                {recentHistory.map((item) => (
                  <button key={item.taskId} className="studio-recent-item" onClick={() => onSelectHistory ? onSelectHistory(item) : onNavigate('review')}>
                    <span className="studio-recent-top"><span className={'studio-outcome ' + outcomeClass(item)}>{outcomeLabel(item)}</span><time>{formatDate(item.createdAt)}</time></span>
                    <strong>{item.userInput || '未命名任务'}</strong>
                    <small>{item.verdict === 'pass' ? '审查通过' : item.verdict === 'conditional' ? '有条件通过' : item.verdict === 'reject' ? '审查未通过' : item.summary || '查看任务记录'}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="studio-history-empty"><span className="studio-empty-mark"><Activity size={16} /></span><strong>还没有任务记录</strong><p>启动第一项任务后，完成结果会出现在这里。</p></div>
            )}
          </section>
        </aside>
      </div>

      <div className="studio-history-stats"><StatsPanel history={history} /></div>
    </main>
  );
};

export default Dashboard;
