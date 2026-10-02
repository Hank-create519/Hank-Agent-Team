import React, { useState } from 'react';
import { PipelineState } from '../../core/types';
import {
  Activity,
  ArrowUpRight,
  Eye,
  Gauge,
  GitBranch,
  Play,
  ShieldCheck,
  Users,
  Box,
  Rocket,
} from 'lucide-react';
import { STAGE_PROGRESS_FULL } from '../../core/Pipeline';
import ReviewTemplates from '../components/ReviewTemplates';
import StatsPanel from '../components/StatsPanel';
import GitPanel from '../components/GitPanel';
import { useAppStore } from '../../store/appStore';

interface DashboardProps {
  pipeline: PipelineState;
  onNavigate: (page: string) => void;
  onStartPipeline: (userInput: string) => void;
  batchQueue?: Array<{
    id: string;
    userInput: string;
    status: 'queued' | 'running' | 'done' | 'failed';
  }>;
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
  done: { label: '完成', icon: ShieldCheck },
};

const DIFFICULTY_BADGE: Record<string, { label: string }> = {
  simple: { label: '简单档 · 快速通道' },
  medium: { label: '中等档 · 单轮审查' },
  complex: { label: '复杂档 · 多轮深度审查' },
};

const Dashboard: React.FC<DashboardProps> = ({
  pipeline,
  onNavigate,
  onStartPipeline,
  batchQueue = [],
  onStartBatch,
}) => {
  const activeAgents = pipeline.agents.filter((agent) => agent.status === 'running').length;
  const idleAgents = pipeline.agents.filter((agent) => agent.status === 'idle').length;
  const errorAgents = pipeline.agents.filter((agent) => agent.status === 'error').length;
  const totalTasks = pipeline.tasks.length;
  const currentStage = STAGE_LABELS[pipeline.stage] || STAGE_LABELS.difficulty_assess;
  const StageIcon = currentStage.icon;
  const displayProgress =
    pipeline.progress > 0 ? pipeline.progress : (STAGE_PROGRESS_FULL[pipeline.stage] ?? 0);

  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const busy = isSubmitting || pipeline.isRunning;

  const handleSubmit = async () => {
    if (!userInput.trim() || busy) return;
    setIsSubmitting(true);
    if (isBatchMode && onStartBatch) {
      const lines = userInput.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) {
        onStartBatch(lines);
      } else {
        onStartPipeline(userInput);
      }
    } else {
      onStartPipeline(userInput);
    }
    setUserInput('');
    onNavigate('pipeline');
    setIsSubmitting(false);
  };

  const difficultyBadge = pipeline.difficulty ? DIFFICULTY_BADGE[pipeline.difficulty] : null;

  const metrics = [
    { label: '运行中的 Agent', value: activeAgents, note: '正在处理当前任务', icon: Activity, color: 'var(--accent-green)' },
    { label: '待命 Agent', value: idleAgents, note: '可随时接手工作', icon: Users, color: 'var(--text-secondary)' },
    { label: '审查轮次', value: pipeline.reviewAuditCount, note: '瀚海审查框架', icon: ShieldCheck, color: 'var(--accent-secondary)' },
    { label: '累计任务', value: totalTasks, note: errorAgents ? errorAgents + ' 个 Agent 需要留意' : '团队运行正常', icon: Gauge, color: errorAgents ? 'var(--accent-red)' : 'var(--accent)' },
  ];

  const quickActions = [
    { label: '查看任务流程', description: '跟进各阶段产出与执行状态', icon: GitBranch, page: 'pipeline', eyebrow: 'PIPELINE' },
    { label: '审查结果', description: '检查结论、问题与改进建议', icon: ShieldCheck, page: 'review', eyebrow: 'REVIEW' },
    { label: '团队活动', description: '查看部门事件与 Agent 动态', icon: Eye, page: 'monitor', eyebrow: 'ACTIVITY' },
  ];

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header animate-fade-up">
        <div className="dashboard-kicker">
          <span className="dashboard-kicker-mark"><Activity size={14} /></span>
          HANK AGENT TEAM
          <span className="dashboard-kicker-divider">/</span>
          工作台
        </div>

        <div className="dashboard-title-row">
          <div className="dashboard-title-copy">
            <h1>让团队把复杂任务，一步步做清楚。</h1>
            <p>从需求拆解到代码审查，多智能体协作的每一步都在这里清晰呈现。</p>
          </div>
          <div className={'workspace-state ' + (pipeline.isRunning ? 'is-running' : 'is-idle')}>
            <span className="workspace-state-dot" />
            <span>{pipeline.isRunning ? '任务进行中' : pipeline.stage === 'done' ? '最近任务已完成' : '团队就绪'}</span>
          </div>
        </div>

        {pipeline.isRunning && (
          <div className="dashboard-live-progress">
            <div className="dashboard-live-progress-copy">
              <span className="dashboard-live-stage"><StageIcon size={14} />{currentStage.label}</span>
              <span>{displayProgress}%</span>
            </div>
            <div className="dashboard-progress-track">
              <span style={{ width: displayProgress + '%' }} />
            </div>
          </div>
        )}

        {difficultyBadge && !pipeline.isRunning && (
          <div className="dashboard-last-run">
            <Gauge size={14} />
            <span>最近任务：{difficultyBadge.label}</span>
            {pipeline.reviewAuditCount > 0 && <span className="dashboard-last-run-detail">· {pipeline.reviewAuditCount} 轮审查</span>}
          </div>
        )}
      </header>

      <section className="task-composer glass-card">
        <div className="task-composer-heading">
          <div>
            <div className="section-eyebrow">NEW TASK</div>
            <h2>你想让团队完成什么？</h2>
            <p>描述目标、背景或限制条件。任务开始后，可以随时查看进度和阶段产出。</p>
          </div>
          <div className="task-composer-tools">
            <ReviewTemplates onSelectTemplate={(template) => setUserInput(template)} />
            <GitPanel onStartReview={onStartPipeline} />
          </div>
        </div>

        <textarea
          id="user-input"
          className="dashboard-textarea"
          value={userInput}
          onChange={(event) => setUserInput(event.target.value)}
          placeholder={isBatchMode
            ? '每行输入一个任务，例如：\n检查认证模块的安全性\n优化列表页的加载性能'
            : '例如：检查登录流程中的安全问题，并提出可落地的修复建议…'}
          rows={isBatchMode ? 5 : 4}
        />

        <div className="task-composer-footer">
          <label className="batch-mode-control">
            <input
              type="checkbox"
              checked={isBatchMode}
              onChange={(event) => setIsBatchMode(event.target.checked)}
            />
            <span className="batch-mode-copy">
              <strong>批量模式</strong>
              <small>每行一个任务</small>
            </span>
          </label>
          <span className="composer-hint">支持需求模板和 Git 仓库审查</span>
          <button
            className="btn btn-primary task-start-button"
            onClick={handleSubmit}
            disabled={!userInput.trim() || busy}
          >
            {busy ? (
              <span className="dot-loader"><span /><span /><span /></span>
            ) : (
              <><Play size={15} fill="currentColor" /><span>启动任务</span><ArrowUpRight size={15} /></>
            )}
          </button>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>运行概况</h2>
            <p>团队状态与最近一次任务的执行情况</p>
          </div>
          <button className="section-link" onClick={() => onNavigate('agents')}>
            团队配置 <ArrowUpRight size={14} />
          </button>
        </div>

        <div className="dashboard-metrics">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article key={metric.label} className="metric-card glass-card">
                <div className="metric-card-top">
                  <span className="metric-label">{metric.label}</span>
                  <span className="metric-icon" style={{ color: metric.color }}><Icon size={16} /></span>
                </div>
                <div className="metric-value" style={{ color: metric.color }}>{metric.value}</div>
                <div className="metric-note">{metric.note}</div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>继续查看</h2>
            <p>进入任务执行过程中的其他工作区</p>
          </div>
        </div>
        <div className="quick-action-grid">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.page}
                className="quick-action-card glass-card"
                onClick={() => onNavigate(action.page)}
              >
                <span className="quick-action-eyebrow">{action.eyebrow}</span>
                <span className="quick-action-icon"><Icon size={18} /></span>
                <span className="quick-action-title">{action.label}</span>
                <span className="quick-action-description">{action.description}</span>
                <ArrowUpRight className="quick-action-arrow" size={16} />
              </button>
            );
          })}
        </div>
      </section>

      {batchQueue.length > 0 && (
        <section className="dashboard-section batch-queue-section">
          <div className="section-heading">
            <div>
              <h2>任务队列</h2>
              <p>{batchQueue.filter((item) => item.status === 'done').length} / {batchQueue.length} 个任务已完成</p>
            </div>
          </div>
          <div className="batch-queue-list glass-card">
            {batchQueue.map((item, index) => {
              const statusLabels: Record<string, string> = {
                queued: '排队中',
                running: '执行中',
                done: '已完成',
                failed: '失败',
              };
              return (
                <div key={item.id} className={'queue-item queue-item-' + item.status}>
                  <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="queue-text" title={item.userInput}>{item.userInput}</span>
                  <span className={'queue-status queue-status-' + item.status}>
                    {item.status === 'running' && <span className="queue-status-pulse" />}
                    {statusLabels[item.status]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="dashboard-history">
        <StatsPanel history={useAppStore((store) => store.history)} />
      </div>
    </div>
  );
};

export default Dashboard;

