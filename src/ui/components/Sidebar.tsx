import React from 'react';
import { PipelineState } from '../../core/types';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  pipeline: PipelineState;
}

// 浮岛窄栏导航 —— 56px 宽，圆角浮起，图标导航（苹果风）
const NAV = [
  { id: 'dashboard', icon: '◆', label: '总览' },
  { id: 'pipeline', icon: '◇', label: '流水线' },
  { id: 'review', icon: '◈', label: '审查详情' },
  { id: 'monitor', icon: '◉', label: '监控' },
  { id: 'agents', icon: '◎', label: '团队' },
];

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, pipeline }) => {
  const activeAgents = pipeline.agents.filter(a => a.status === 'running').length;

  return (
    <aside
      style={{
        position: 'fixed',
        left: 8,
        top: 8,
        bottom: 8,
        width: 56,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 0',
        borderRadius: 20,
        background: 'var(--bg-card)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid var(--border)',
        userSelect: 'none',
      }}
    >
      {/* Logo */}
      <button
        onClick={() => onNavigate('dashboard')}
        title="Hank Agent Team"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 24,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-secondary))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          H
        </span>
      </button>

      {/* 导航 */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {NAV.map(item => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                cursor: 'pointer',
                border: 'none',
                background: active ? 'rgba(77, 171, 247, 0.15)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                transition: 'all 200ms var(--spring)',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.background = 'var(--bg-card-hover)';
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {item.icon}
            </button>
          );
        })}
      </nav>

      {/* 进度小圆环 */}
      <div
        title={`进度 ${pipeline.progress}%`}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-card-hover)',
          marginBottom: 4,
          position: 'relative',
        }}
      >
        <svg width="36" height="36" style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
          <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="2.5" />
          <circle
            cx="18" cy="18" r="14" fill="none"
            stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 14 * pipeline.progress / 100} ${2 * Math.PI * 14}`}
            style={{ transition: 'stroke-dasharray 0.5s var(--spring)' }}
          />
        </svg>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--accent)', position: 'relative' }}>
          {pipeline.progress}
        </span>
      </div>

      {/* 活跃指示 */}
      {activeAgents > 0 && (
        <div
          title={`${activeAgents} 个 Agent 运行中`}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--accent-green)',
            boxShadow: '0 0 8px rgba(52, 199, 89, 0.6)',
            animation: 'dot-pulse 1.4s var(--spring) infinite',
          }}
        />
      )}
    </aside>
  );
};

export default Sidebar;
