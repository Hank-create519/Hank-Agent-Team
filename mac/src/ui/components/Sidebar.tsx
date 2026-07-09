import React, { useState, useEffect } from 'react';
import { PipelineState } from '../../core/types';
import { useAppStore } from '../../store/appStore';
import type { HistoryItem } from '../../store/appStore';
import { Settings, Sun, Moon } from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  pipeline: PipelineState;
  onSelectHistory?: (item: HistoryItem) => void;
}

const NAV_ITEMS = [
  { id: 'dashboard', icon: '\u25C8', label: '总览' },
  { id: 'pipeline', icon: '\u25C7', label: '流水线' },
  { id: 'review', icon: '\u25C8', label: '审查详情' },
  { id: 'monitor', icon: '\u25C9', label: '监控' },
  { id: 'agents', icon: '\u25CE', label: '团队配置' },
];

const activeBarStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  width: 3,
  borderRadius: '0 3px 3px 0',
  background: 'var(--accent)',
};

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, pipeline, onSelectHistory }) => {
  const history = useAppStore((s) => s.history);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') setDarkMode(false);
  }, []);

  return (
    <aside
      style={{
        width: 260,
        minWidth: 260,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)',
        userSelect: 'none',
        zIndex: 50,
      }}
    >
      {/* ===== 项目名 ===== */}
      <div style={{ padding: '24px 20px 8px' }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
          }}
        >
          Hank Agent Team
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginTop: 2,
          }}
        >
          Agent Team v42
        </div>
      </div>

      {/* ===== 导航 ===== */}
      <div style={{ padding: '16px 0 4px' }}>
        <div
          style={{
            padding: '0 20px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          NAVIGATION
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column' }}>
          {NAV_ITEMS.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                title={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  height: 36,
                  padding: '0 20px',
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer',
                  border: 'none',
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  position: 'relative',
                  transition: 'all 150ms var(--spring)',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                {active && <span style={activeBarStyle} />}
                <span style={{ fontSize: 12, width: 16, textAlign: 'center' }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ===== 审查历史 ===== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0 4px' }}>
        <div
          style={{
            padding: '0 20px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
          }}
        >
          REVIEW HISTORY
        </div>
        {history.length === 0 && (
          <div style={{ padding: '4px 20px', fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.6 }}>
            暂无审查记录
          </div>
        )}
        {history.slice(0, 10).map((item, i) => {
          const timeLabel = (() => {
            const diff = Date.now() - new Date(item.createdAt).getTime();
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return '刚刚';
            if (mins < 60) return `${mins}m ago`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs}h ago`;
            return `${Math.floor(hrs / 24)}d ago`;
          })();
          return (
            <button
              key={i}
              onClick={() => onSelectHistory?.(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 20px',
                fontSize: 12,
                cursor: 'pointer',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary)',
                transition: 'all 120ms',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: item.success ? 'var(--accent-green)' : 'var(--accent-orange)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {item.userInput.length > 28 ? item.userInput.slice(0, 28) + '...' : item.userInput}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{timeLabel}</span>
            </button>
          );
        })}
      </div>

      {/* ===== 底部状态 & 设置 ===== */}
      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* 活跃 Agent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: pipeline.isRunning ? 'var(--accent-green)' : 'var(--text-tertiary)',
              animation: pipeline.isRunning ? 'dot-pulse 1.4s var(--spring) infinite' : 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {pipeline.isRunning
              ? `${pipeline.agents.filter((a) => a.status === 'running').length} Agent 运行中`
              : '待机中'}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent)',
              fontWeight: 600,
            }}
          >
            {pipeline.progress}%
          </span>
        </div>
        {/* 进度条 */}
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: 'var(--border)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pipeline.progress}%`,
              background: 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.4s var(--spring)',
            }}
          />
        </div>
        {/* P2-13: 主题切换 */}
        <button
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? '切换到亮色主题' : '切换到深色主题'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          <span>{darkMode ? '亮色主题' : '深色主题'}</span>
        </button>

        {/* 设置按钮 */}
        <button
          onClick={() => onNavigate('agents')}
          title="Settings"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            transition: 'all 120ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
