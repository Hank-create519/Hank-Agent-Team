import React, { useEffect, useRef, useState } from 'react';
import { LogEntry, Department } from '../../core/types';

interface LogStreamProps {
  logs: LogEntry[];
  maxHeight?: number;
}

// 部门色映射
const DEPT_COLORS: Record<Department, string> = {
  command: 'var(--dept-command)',
  info: 'var(--dept-info)',
  develop: 'var(--dept-develop)',
  review: 'var(--dept-review)',
};

const LogStream: React.FC<LogStreamProps> = ({ logs, maxHeight = 400 }) => {
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  useEffect(() => {
    if (!containerRef.current || !isScrolledToBottom) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [logs.length, isScrolledToBottom]);

  // 监听滚动
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setIsScrolledToBottom(scrollTop + clientHeight >= scrollHeight - 5);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        height: maxHeight,
        overflowY: 'auto',
        padding: '16px 20px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        position: 'relative',
      }}
    >
      {logs.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-tertiary)',
            fontSize: 14,
          }}
        >
          <div className="dot-loader" style={{ marginBottom: 12 }}>
            <span />
            <span />
            <span />
          </div>
          <span>等待流水线启动...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {logs.map((log, i) => (
            <div
              key={i}
              className="glass-card"
              style={{
                padding: '16px 20px',
                borderLeft: `3px solid ${DEPT_COLORS[log.department] || 'var(--accent)'}`,
                animation: `fade-up 500ms var(--spring) ${i * 0.08}s both`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: `${DEPT_COLORS[log.department]}20`,
                    color: DEPT_COLORS[log.department],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {log.agentName?.[0] || '?'}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: DEPT_COLORS[log.department],
                  }}
                >
                  {log.agentName || log.department}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {new Date(log.time).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {log.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LogStream;
