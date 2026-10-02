import React, { useState, useEffect } from 'react';
import { PipelineState } from '../../core/types';
import { useAppStore } from '../../store/appStore';
import type { HistoryItem } from '../../store/appStore';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';

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

type ThemeMode = 'dark' | 'light' | 'auto';

const THEME_LABEL: Record<ThemeMode, string> = {
  dark: '深色主题',
  light: '浅色主题',
  auto: '跟随系统',
};
const THEME_ORDER: ThemeMode[] = ['dark', 'light', 'auto'];

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, pipeline, onSelectHistory }) => {
  const history = useAppStore((s) => s.history);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useAppStore((s) => s.toggleSidebar);
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => (localStorage.getItem('theme-mode') as ThemeMode) || 'dark'
  );

  useEffect(() => {
    const apply = () => {
      const effective = themeMode === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : themeMode;
      if (effective === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    };
    apply();
    localStorage.setItem('theme-mode', themeMode);
    localStorage.setItem('theme', themeMode === 'auto' ? 'auto' : themeMode);
    if (themeMode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeMode]);

  return (
    <aside
      style={{
        width: collapsed ? 64 : 260,
        minWidth: collapsed ? 64 : 260,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--glass-bg-strong)',
        backdropFilter: 'blur(32px) saturate(1.7)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.7)',
        transition: 'width var(--dur-normal) var(--spring), min-width var(--dur-normal) var(--spring)',
        borderRight: '1px solid var(--border)',
        userSelect: 'none',
        zIndex: 50,
      }}
    >
      {/* ===== 项目名 + 折叠开关 ===== */}
      <div style={{ padding: collapsed ? '16px 10px 8px' : '24px 20px 8px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
        {collapsed ? (
          <button
            onClick={toggleCollapsed}
            title="展开侧栏"
            style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}
          >
            »
          </button>
        ) : (
        <div>
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
        )}
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            title="收起侧栏"
            style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}
          >
            «
          </button>
        )}
      </div>

      {/* ===== 导航 ===== */}
      <div style={{ padding: '16px 0 4px' }}>
        {!collapsed && (
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
        )}
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
                  padding: collapsed ? 0 : '0 20px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
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
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ===== 审查历史 ===== */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0 4px', display: collapsed ? 'none' : 'block' }}>
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
          <div className="empty-state" style={{ padding: '14px 20px' }}>
            <span className="empty-title">暂无审查记录</span>
            <span className="empty-hint">在总览页运行一次任务后，记录会显示在这里</span>
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
                  background: item.outcome === 'completed' ? 'var(--accent-green)'
                    : item.outcome === 'demo' || (!item.outcome && item.demoUsed) ? '#7c6cf0'
                    : item.outcome === 'failed' ? 'var(--accent-red)'
                    : item.outcome === 'cancelled' ? 'var(--text-tertiary)'
                    : 'var(--accent-orange)',
                  flexShrink: 0,
                }}
                title={item.outcome === 'demo' || (!item.outcome && item.demoUsed) ? '演示任务（非真实执行）'
                  : item.outcome === 'completed' ? '真实完成'
                  : item.outcome === 'failed' ? '失败'
                  : item.outcome === 'cancelled' ? '已取消'
                  : '未完成'}
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
              {(item.outcome === 'demo' || (!item.outcome && item.demoUsed)) && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                  background: 'rgba(124,108,240,0.18)', color: '#a99df5',
                }}>演示</span>
              )}
              {item.outcome === 'failed' && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                  background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)',
                }}>失败</span>
              )}
              {item.outcome === 'cancelled' && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                  background: 'rgba(150,150,160,0.15)', color: 'var(--text-tertiary)',
                }}>取消</span>
              )}
              {item.difficultyDegraded && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                  background: 'rgba(250,179,21,0.15)', color: '#e2a336',
                }} title="难度评估降级：LLM 调用失败，使用关键词兜底判定">降级</span>
              )}
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
        {/* 活跃 Agent（折叠态隐藏：内容依赖文字） */}
        <div style={{ display: collapsed ? 'none' : 'flex', alignItems: 'center', gap: 8 }}>
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
          onClick={() => setThemeMode(THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length])}
          title={`当前：${THEME_LABEL[themeMode]}，点击切换`}
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
          {themeMode === 'dark' ? <Moon size={14} /> : themeMode === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
          {!collapsed && <span>{THEME_LABEL[themeMode]}</span>}
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
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
