import React from 'react';

interface StatusBarProps {
  isRunning: boolean;
  stage: string;
  model: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ isRunning, stage, model }) => {
  if (!isRunning && stage === 'done') return null;

  return (
    <div
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-tertiary)',
        flexShrink: 0,
      }}
    >
      <span>model: {model}</span>
      {stage && (
        <>
          <span style={{ margin: '0 6px', color: 'var(--border-hover)' }}>&middot;</span>
          <span>stage: {stage}</span>
        </>
      )}
    </div>
  );
};

export default StatusBar;
