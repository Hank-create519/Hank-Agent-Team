import React, { useState } from 'react';
import { PipelineState, Department } from '../../core/types';
import { Activity, GitBranch, Users, Play, ShieldCheck, Box, Rocket } from 'lucide-react';
import { STAGE_PROGRESS } from '../../core/Pipeline';

interface DashboardProps {
  pipeline: PipelineState;
  onNavigate: (page: string) => void;
  onStartPipeline: (userInput: string) => void;
}

const STAGE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  init: { label: '制定方案', icon: Activity },
  audit_entry: { label: '审查把关', icon: ShieldCheck },
  extract: { label: '信息提取', icon: Box },
  content_review: { label: '内容审核', icon: ShieldCheck },
  develop: { label: '开发编码', icon: Play },
  code_review: { label: '代码审核', icon: ShieldCheck },
  deploy: { label: '部署上线', icon: Rocket },
  done: { label: '完成', icon: ShieldCheck },
};

const Dashboard: React.FC<DashboardProps> = ({ pipeline, onNavigate, onStartPipeline }) => {
  const activeAgents = pipeline.agents.filter(a => a.status === 'running').length;
  const idleAgents = pipeline.agents.filter(a => a.status === 'idle').length;
  const errorAgents = pipeline.agents.filter(a => a.status === 'error').length;
  const totalTasks = pipeline.tasks.length;

  const currentStage = STAGE_LABELS[pipeline.stage] || STAGE_LABELS.init;
  const StageIcon = currentStage.icon;
  const displayProgress = pipeline.progress > 0 ? pipeline.progress : (STAGE_PROGRESS[pipeline.stage] ?? 0);

  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!userInput.trim() || isSubmitting) return;
    setIsSubmitting(true);
    onStartPipeline(userInput);
    onNavigate('pipeline');
    setIsSubmitting(false);
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Hero —— 新增启动入口 */}
      <div
        className="glass-card"
        style={{
          padding: '48px 52px',
          marginBottom: 36,
          borderRadius: 'var(--radius-xl)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              marginBottom: 16,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-secondary))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Hank Agent Team
          </h1>
          <p
            style={{
              fontSize: 18,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
              maxWidth: 640,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            多部门 AI 协作流水线系统。指挥部、信息部、开发部、审核部四部门直连协作，自动完成从需求到交付的全流程。
          </p>
        </div>

        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div>
            <label
              htmlFor="user-input"
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: 12,
              }}
            >
              请描述你的需求
            </label>
            <textarea
              id="user-input"
              value={userInput}
              onChange={e => setUserInput(e.target.value)}
              placeholder="例如：帮我创建一个 Electron + React 的桌面应用，支持多 Agent 协作和模型配置..."
              rows={3}
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: 14,
                resize: 'vertical',
                minHeight: 120,
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleSubmit}
              disabled={!userInput.trim() || isSubmitting}
              style={{
                minWidth: 200,
                boxShadow: '0 0 20px rgba(77, 171, 247, 0.2)',
                opacity: !userInput.trim() || isSubmitting ? 0.6 : 1,
                cursor: !userInput.trim() || isSubmitting ? 'not-allowed' : 'pointer',
              }}
            >
              {isSubmitting ? (
                <span className="dot-loader">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                '启动流水线'
              )}
            </button>
            <button
              className="btn btn-secondary btn-lg"
              onClick={() => onNavigate('agents')}
              style={{ minWidth: 160 }}
            >
              配置团队
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: '活跃 Agent', value: activeAgents, color: 'var(--accent-green)', icon: Activity },
          { label: '待命 Agent', value: idleAgents, color: 'var(--text-tertiary)', icon: Users },
          { label: '错误', value: errorAgents, color: 'var(--accent-red)', icon: ShieldCheck },
          { label: '任务数', value: totalTasks, color: 'var(--accent)', icon: Box },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="glass-card"
              style={{
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  {stat.label}
                </span>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: `${stat.color}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={14} color={stat.color} />
                </div>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: stat.color, lineHeight: 1 }}>
                {stat.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: '流水线监控', desc: '查看任务执行流程与各阶段状态', icon: GitBranch, page: 'pipeline' },
          { label: 'Agent 团队', desc: '管理各部门 Agent 与干预操作', icon: Users, page: 'agents' },
          { label: '当前阶段', desc: currentStage.label, icon: StageIcon, page: 'pipeline' },
        ].map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.page)}
              className="glass-card"
              style={{
                padding: '24px',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                background: 'var(--bg-card)',
                width: '100%',
                whiteSpace: 'normal',
                fontFamily: 'inherit',
                display: 'block',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(77,171,247,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <Icon size={20} color="var(--accent)" />
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.5,
                  wordBreak: 'break-all',
                }}
              >
                {item.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default Dashboard;
