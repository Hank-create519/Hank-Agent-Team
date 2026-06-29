import React from 'react';
import { PipelineState, PipelineStage, StageOutput } from '../../core/types';
import { Play, Pause, ShieldCheck, Box, Rocket, Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import { STAGE_PROGRESS } from '../../core/Pipeline';
import { STAGE_LABELS } from '../../core/Engine';
import LogStream from '../components/LogStream';

interface PipelineViewProps {
  pipeline: PipelineState;
  onStageChange: (stage: PipelineStage, progress: number) => void;
  onTogglePause: () => void;
}

const STAGES: { stage: PipelineStage; label: string; icon: React.ElementType; desc: string }[] = [
  { stage: 'init', label: '指挥部制定方案', icon: Activity, desc: '拆解需求 → 生成初步方案' },
  { stage: 'audit_entry', label: '审查系统把关', icon: ShieldCheck, desc: '评估方案合理性 + 风险建议' },
  { stage: 'extract', label: '信息部提取', icon: Box, desc: '提取关键信息 → 结构化输出' },
  { stage: 'content_review', label: '内容审核', icon: ShieldCheck, desc: '审核信息准确性（只判错）' },
  { stage: 'develop', label: '开发部编码', icon: Play, desc: '编码实现 + 队长自检' },
  { stage: 'code_review', label: '代码审核', icon: ShieldCheck, desc: '审核代码错误 + 改进建议' },
  { stage: 'deploy', label: '部署上线', icon: Rocket, desc: '部署 → 失败重试 → 汇报' },
  { stage: 'done', label: '完成', icon: CheckCircle, desc: '汇总结果 → 交付用户' },
];

const PipelineView: React.FC<PipelineViewProps> = ({ pipeline, onStageChange, onTogglePause }) => {
  const currentIdx = STAGES.findIndex(s => s.stage === pipeline.stage);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header + Control */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            流水线监控
          </h2>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            {pipeline.paused ? '已暂停' : '运行中'} · 审核打回次数: {pipeline.reviewRejectCount}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {pipeline.paused ? (
            <button
              onClick={onTogglePause}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(52, 199, 89, 0.12)',
                border: '1px solid rgba(52, 199, 89, 0.3)',
                color: 'var(--accent-green)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Play size={14} /> 继续
            </button>
          ) : (
            <button
              onClick={onTogglePause}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: 'var(--accent-orange)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Pause size={14} /> 暂停
            </button>
          )}
        </div>
      </div>

      {/* Pipeline Timeline */}
      <div style={{ position: 'relative', marginBottom: 32 }}>
        {STAGES.map((item, idx) => {
          const Icon = item.icon;
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;

          // 获取该阶段产出
          const output = pipeline.stageOutputs[item.stage] as StageOutput | undefined;

          return (
            <div key={item.stage} style={{ display: 'flex', gap: 20, marginBottom: idx < STAGES.length - 1 ? 0 : 0 }}>
              {/* Timeline line + dot */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  width: 40,
                  minWidth: 40,
                }}
              >
                <div
                  style={{
                    width: isCurrent ? 36 : 28,
                    height: isCurrent ? 36 : 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isDone
                      ? 'rgba(52, 199, 89, 0.2)'
                      : isCurrent
                      ? 'rgba(77, 171, 247, 0.2)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: `2px solid ${
                      isDone ? 'var(--accent-green)' : isCurrent ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'
                    }`,
                    position: 'relative',
                    zIndex: 2,
                  }}
                >
                  <Icon
                    size={14}
                    color={
                      isDone ? 'var(--accent-green)' : isCurrent ? 'var(--accent)' : 'var(--text-tertiary)'
                    }
                  />
                </div>
                {idx < STAGES.length - 1 && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 40,
                      background: isDone
                        ? 'linear-gradient(180deg, var(--accent-green), rgba(52, 199, 89, 0.2))'
                        : 'rgba(255, 255, 255, 0.06)',
                      marginTop: 4,
                    }}
                  />
                )}
              </div>

              {/* Card */}
              <div
                className="glass-card"
                style={{
                  flex: 1,
                  padding: '16px 20px',
                  marginBottom: 12,
                  opacity: isFuture ? 0.4 : 1,
                  transition: 'all 0.3s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: isCurrent ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: isDone
                        ? 'rgba(52, 199, 89, 0.1)'
                        : isCurrent
                        ? 'rgba(77, 171, 247, 0.1)'
                        : 'transparent',
                      color: isDone ? 'var(--accent-green)' : isCurrent ? 'var(--accent)' : 'var(--text-tertiary)',
                    }}
                  >
                    {isDone ? '已完成' : isCurrent ? '进行中' : '等待'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{item.desc}</div>

                {/* 阶段产出 */}
                {output && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(0, 0, 0, 0.2)',
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 8,
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span style={{ color: 'var(--accent)' }}>
                        {output.agentName}
                      </span>
                      <span>·</span>
                      <span>{output.department}</span>
                      <span>·</span>
                      <span>{new Date(output.timestamp).toLocaleTimeString('zh-CN')}</span>
                    </div>
                    <div style={{ color: 'var(--text-primary)' }}>{output.content}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 实时日志流 */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
          实时日志
        </h3>
        <LogStream logs={pipeline.messages} maxHeight={300} />
      </div>

      {/* Errors */}
      {pipeline.errors.length > 0 && (
        <div
          style={{
            marginTop: 24,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={16} color="var(--accent-red)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)' }}>错误列表</span>
          </div>
          {pipeline.errors.map((err, i) => (
            <div key={i} style={{ fontSize: 12, color: '#FCA5A5', marginBottom: 4 }}>
              {err}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PipelineView;
