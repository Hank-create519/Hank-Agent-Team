import React, { useRef, useEffect } from 'react';
import { PipelineState, PipelineStage, IssueItem } from '../../core/types';

interface ResultPanelProps {
  pipeline: PipelineState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const STAGES: PipelineStage[] = [
  'difficulty_assess', 'init', 'audit_entry', 'extract', 'content_review',
  'develop', 'code_review', 'deep_audit', 'deploy', 'done',
];

const STAGE_NAME: Record<PipelineStage, string> = {
  difficulty_assess: 'difficulty_assess', init: 'init', audit_entry: 'audit_entry',
  extract: 'extract', content_review: 'content_review', develop: 'develop',
  code_review: 'code_review', deep_audit: 'deep_audit', deploy: 'deploy', done: 'done',
};

const SX: Record<string, React.CSSProperties> = {
  mono: { fontFamily: 'var(--font-mono)' },
  monoSm: { fontFamily: 'var(--font-mono)', fontSize: 12 },
  monoXs: { fontFamily: 'var(--font-mono)', fontSize: 11 },
  monoXxs: { fontFamily: 'var(--font-mono)', fontSize: 10 },
};

// ============================================================
// Severity helpers
// ============================================================
const SEV_MAP: Record<string, { emoji: string; label: string; color: string }> = {
  high:     { emoji: 'CRITICAL', label: 'CRITICAL', color: 'var(--danger)' },
  medium:   { emoji: 'WARNING',  label: 'WARNING',  color: 'var(--warn)' },
  low:      { emoji: 'SUGGESTION', label: 'SUGGESTION', color: 'var(--info)' },
};

const ResultPanel: React.FC<ResultPanelProps> = ({ pipeline, onPause, onResume, onStop }) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pipeline.log.length]);

  // Derive issues from review framework or stage outputs
  const issues: IssueItem[] =
    pipeline.reviewFramework?.finalReport?.issues ??
    [];

  const verdict = pipeline.reviewFramework?.finalReport?.verdict;
  const totalRounds = pipeline.reviewFramework?.finalReport?.totalRounds ?? 0;
  const totalTime = pipeline.reviewFramework?.finalReport?.totalElapsedMs ?? 0;

  const criticalCount = issues.filter((i) => i.severity === 'high').length;
  const warningCount = issues.filter((i) => i.severity === 'medium').length;
  const suggestCount = issues.filter((i) => i.severity === 'low').length;

  const doneStageOutput = pipeline.stageOutputs.done;

  // ---- Idle ----
  if (!pipeline.isRunning && pipeline.stage === 'done' && !verdict && issues.length === 0) {
    const hasNoTask = !pipeline.taskId;
    if (hasNoTask) {
      return (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'var(--text-tertiary)',
            ...SX.mono,
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--accent)' }}>$ hank ready</span>
          <span>paste code or describe your task on the left</span>
        </div>
      );
    }
  }

  // ---- Done / Result ----
  const isDone = pipeline.stage === 'done' && !pipeline.isRunning && (verdict || doneStageOutput);
  if (isDone) {
    return (
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ ...SX.mono, fontSize: 14, color: 'var(--accent)' }}>
          {verdict === 'pass'
            ? '\u258eREVIEW COMPLETE \u2014 PASS'
            : verdict === 'conditional'
              ? '\u258eREVIEW COMPLETE \u2014 PASS WITH ISSUES'
              : verdict === 'reject'
                ? '\u258eREVIEW COMPLETE \u2014 REJECTED'
                : '\u258eTASK COMPLETE'}
        </div>

        {/* Summary */}
        <div
          style={{
            ...SX.monoSm,
            color: 'var(--text-secondary)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {issues.length > 0 && (
            <>
              <span>
                Summary: {issues.length} issues
              </span>
              {criticalCount > 0 && <span style={{ color: 'var(--danger)' }}>{criticalCount} critical</span>}
              {warningCount > 0 && <span style={{ color: 'var(--warn)' }}>{warningCount} warnings</span>}
              {totalTime > 0 && (
                <span>{`${(totalTime / 1000).toFixed(1)}s`}</span>
              )}
            </>
          )}
          {doneStageOutput && (
            <span>{doneStageOutput.summary}</span>
          )}
        </div>

        {/* Issues */}
        {issues.map((issue, idx) => {
          const sev = SEV_MAP[issue.severity] ?? SEV_MAP.medium;
          return (
            <div
              key={idx}
              style={{
                border: `1px solid var(--border)`,
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'var(--bg-input)',
                  ...SX.monoXs,
                  color: sev.color,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span>#{idx + 1}</span>
                <span style={{ fontWeight: 600 }}>{sev.label}</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                  {issue.desc}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                }}
              >
                <button className="btn-primary" style={{ fontSize: 11, padding: '5px 10px' }}>
                  View Fix
                </button>
                <button className="btn-ghost" style={{ fontSize: 11 }}>
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}

        {/* Log tail */}
        {pipeline.log.length > 0 && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
            }}
          >
            <div style={{ ...SX.monoXxs, color: 'var(--text-tertiary)', marginBottom: 6 }}>
              LOG
            </div>
            {pipeline.log.slice(-10).map((l, i) => (
              <div
                key={i}
                style={{
                  ...SX.monoXxs,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.8,
                }}
              >
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {new Date(l.time).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>{' '}
                {l.message}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- Running ----
  const currentIdx = STAGES.indexOf(pipeline.stage);
  const currentAgent =
    pipeline.agents.find((a) => a.status === 'running')?.name ??
    pipeline.agents[0]?.name ??
    '...';

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        gap: 16,
        overflowY: 'auto',
      }}
    >
      {/* Running header */}
      <div style={{ ...SX.monoSm, color: 'var(--accent)' }}>
        analyzing...
        <span className="cursor-blink" style={{ fontSize: 14 }} />
      </div>

      {/* Progress bar */}
      <div>
        <div
          style={{
            height: 2,
            background: 'var(--border)',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pipeline.progress}%`,
              background: 'var(--accent)',
              transition: 'width .4s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            ...SX.monoXxs,
            color: 'var(--text-tertiary)',
          }}
        >
          <span>
            phase: {STAGE_NAME[pipeline.stage]} &middot; agent: {currentAgent}
          </span>
          <span>{pipeline.progress}%</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8 }}>
        {pipeline.paused ? (
          <button className="btn-primary" onClick={onResume} style={{ fontSize: 11 }}>
            Resume
          </button>
        ) : (
          <button className="btn-ghost" onClick={onPause} style={{ fontSize: 11 }}>
            Pause
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={onStop}
          style={{ fontSize: 11, color: 'var(--danger)', borderColor: 'var(--danger)' }}
        >
          Stop
        </button>
      </div>

      {/* Phase timeline */}
      <div>
        <div style={{ ...SX.monoXxs, color: 'var(--text-tertiary)', marginBottom: 8 }}>
          PHASES
        </div>
        {STAGES.filter(
          (s) =>
            pipeline.difficulty !== 'simple' ||
            !['audit_entry', 'content_review', 'code_review', 'deep_audit'].includes(s),
        ).map((stage) => {
          const idx = STAGES.indexOf(stage);
          const done = idx < currentIdx;
          const current = idx === currentIdx;
          const future = idx > currentIdx;

          return (
            <div
              key={stage}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                opacity: future ? 0.4 : 1,
                ...SX.monoXs,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: done ? 'var(--accent)' : current ? 'var(--accent)' : 'transparent',
                  border:
                    !done && !current ? '1.5px solid var(--border-hover)' : 'none',
                  boxShadow: current ? '0 0 6px var(--accent)' : 'none',
                }}
              />
              <span
                style={{
                  color: done
                    ? 'var(--text-secondary)'
                    : current
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  fontWeight: current ? 600 : 400,
                }}
              >
                {STAGE_NAME[stage]}
              </span>
              {done && (
                <span style={{ color: 'var(--accent)', fontSize: 10 }}>
                  &#x2713;
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Log stream */}
      {pipeline.log.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 10,
          }}
        >
          <div style={{ ...SX.monoXxs, color: 'var(--text-tertiary)', marginBottom: 6 }}>
            LOG
          </div>
          <div style={{ maxHeight: 140, overflowY: 'auto' }}>
            {pipeline.log.slice(-8).reverse().map((l, i) => (
              <div
                key={i}
                style={{
                  ...SX.monoXxs,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.8,
                }}
              >
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {new Date(l.time).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>{' '}
                {l.message}
              </div>
            ))}
          </div>
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
};

export default ResultPanel;
