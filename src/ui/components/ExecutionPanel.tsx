import React from 'react';
import { PipelineState, PipelineStage } from '../../core/types';

interface Props { pipeline: PipelineState; }

const STAGES: PipelineStage[] = [
  'difficulty_assess', 'init', 'audit_entry', 'extract', 'content_review',
  'develop', 'code_review', 'deep_audit', 'deploy', 'done',
];

const STAGE_NAME: Record<PipelineStage, string> = {
  difficulty_assess: '难度评估', init: '制定方案', audit_entry: '审查把关',
  extract: '信息提取', content_review: '内容审核', develop: '编码开发',
  code_review: '代码审核', deep_audit: '深度审计', deploy: '部署', done: '完成',
};

const ExecutionPanel: React.FC<Props> = ({ pipeline }) => {
  const currentIdx = STAGES.indexOf(pipeline.stage);
  const skipOnSimple = (s: PipelineStage) =>
    pipeline.difficulty === 'simple' && ['audit_entry', 'content_review', 'code_review', 'deep_audit'].includes(s);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* 顶部进度 */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-tertiary)' }}>EXECUTION</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: pipeline.isRunning ? 'var(--accent)' : 'var(--text-dim)' }}>
            {pipeline.isRunning ? (pipeline.paused ? 'paused' : 'running') : 'idle'}
          </span>
        </div>
        {/* 进度条 */}
        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pipeline.progress}%`, background: 'var(--accent)',
            transition: 'width .4s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
            {pipeline.difficulty || '—'}
          </span>
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
            {pipeline.progress}%
          </span>
        </div>
      </div>

      {/* 阶段时间线 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {STAGES.filter(s => !skipOnSimple(s)).map((stage, idx, arr) => {
          const filteredIdx = arr.indexOf(stage);
          const done = filteredIdx < currentIdx;
          const current = filteredIdx === currentIdx;
          const future = filteredIdx > currentIdx;
          const isLast = idx === arr.length - 1;

          return (
            <div key={stage} style={{ display: 'flex', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flexShrink: 0 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: done ? 'var(--accent)' : current ? 'var(--accent)' : 'transparent',
                  border: current ? 'none' : `1.5px solid ${done ? 'var(--accent)' : 'var(--border-light)'}`,
                  boxShadow: current ? '0 0 6px var(--accent)' : 'none',
                }} />
                {!isLast && <div style={{ width: 1, flex: 1, minHeight: 22, background: done ? 'var(--accent)' : 'var(--border)' }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 14, opacity: future ? 0.4 : 1 }}>
                <div style={{
                  fontSize: 12, fontFamily: 'var(--mono)',
                  color: done ? 'var(--text-secondary)' : current ? 'var(--text)' : 'var(--text-tertiary)',
                  fontWeight: current ? 600 : 400,
                }}>{STAGE_NAME[stage]}</div>
                {current && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {pipeline.agents.filter(a => a.status === 'running').map(a => a.name).join(', ') || '...'}
                  </div>
                )}
              </div>
              {done && <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)', alignSelf: 'flex-start', marginTop: 2 }}>✓</span>}
            </div>
          );
        })}
      </div>

      {/* 日志流 */}
      {pipeline.log.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', maxHeight: 140, overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', marginBottom: 6 }}>LOG</div>
          {pipeline.log.slice(-6).reverse().map((log, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'var(--mono)', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-dim)' }}>{new Date(log.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              {' '}
              {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExecutionPanel;
