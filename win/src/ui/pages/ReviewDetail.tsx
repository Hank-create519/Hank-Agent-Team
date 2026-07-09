import React, { useState } from 'react';
import { PipelineState, ReviewFrameworkState, ReviewRound } from '../../core/types';
import type { HistoryItem } from '../../store/appStore';
import { useAppStore } from '../../store/appStore';
import { Shield, CheckCircle, AlertTriangle, XCircle, Layers, Users, FileText, Download, Check, X } from 'lucide-react';

interface ReviewDetailProps {
  pipeline: PipelineState;
  historyItem?: HistoryItem;
}

const PHASE_LABELS: Record<string, string> = {
  idle: '待机',
  prep_extract: '准备层 · 信息提取',
  prep_judge: '准备层 · 轮次判定',
  debate: '判定层 · 交叉审查',
  summary: '总结层 · 生成报告',
  done: '已完成',
};

type VerdictKey = 'pass' | 'conditional' | 'reject';

const VERDICT_CONFIG: Record<VerdictKey, { label: string; icon: any; color: string }> = {
  pass: { label: '通过', icon: CheckCircle, color: 'var(--accent-green)' },
  conditional: { label: '有条件通过', icon: AlertTriangle, color: 'var(--accent-orange)' },
  reject: { label: '驳回', icon: XCircle, color: 'var(--accent-red)' },
};

// ============ Export helpers ============
const buildReportMarkdown = (item: HistoryItem): string => {
  const lines: string[] = [];
  lines.push(`# 审查报告`);
  lines.push('');
  lines.push(`- **任务 ID**: ${item.taskId}`);
  lines.push(`- **用户输入**: ${item.userInput}`);
  lines.push(`- **难度**: ${item.difficulty || 'N/A'}`);
  lines.push(`- **审查轮数**: ${item.reviewAuditCount}`);
  lines.push(`- **最终裁决**: ${item.verdict || 'N/A'}`);
  lines.push(`- **成功**: ${item.success ? '是' : '否'}`);
  lines.push(`- **时间**: ${item.createdAt}`);
  lines.push(`- **摘要**: ${item.summary}`);
  lines.push('');

  if (item.pros && item.pros.length > 0) {
    lines.push('## 做得好的地方');
    item.pros.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }

  if (item.issues && item.issues.length > 0) {
    lines.push('## 存在的问题');
    item.issues.forEach((issue) => {
      lines.push(`- **[${issue.severity.toUpperCase()}]** ${issue.desc}`);
    });
    lines.push('');
  }

  if (item.suggestions && item.suggestions.length > 0) {
    lines.push('## 修改建议');
    item.suggestions.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  return lines.join('\n');
};

const buildReportHTML = (item: HistoryItem): string => {
  const md = buildReportMarkdown(item);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>审查报告 - ${item.taskId}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#0d0d0d;color:#ececec}h1{color:#10a37f}h2{color:#9d9d9d;margin-top:24px}li{margin:6px 0}</style></head><body>
${md.split('\n').map(line => {
  if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
  if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
  if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
  return line ? `<p>${line}</p>` : '';
}).join('\n')}
</body></html>`;
};

// ============ History Task View ============
const HistoryTaskView: React.FC<{ item: HistoryItem }> = ({ item }) => {
  const store = useAppStore();
  const taskFixes = store.taskFixes[item.taskId] || {};
  const [exportOpen, setExportOpen] = useState(false);

  const handleExport = (format: string) => {
    setExportOpen(false);
    const content = format === 'html' ? buildReportHTML(item) : buildReportMarkdown(item);
    const ext = format === 'html' ? 'html' : 'md';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-report-${item.taskId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyAllFixes = () => {
    const accepted = Object.entries(taskFixes)
      .filter(([, v]) => v === 'accepted')
      .map(([idx]) => {
        const issue = item.issues?.[Number(idx)];
        return issue ? `# Issue ${Number(idx) + 1}: ${issue.desc}\n${issue.fixSuggestion || '(无修复建议)'}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (!accepted) return;
    const patch = `# Patch for ${item.taskId}\n# Generated: ${new Date().toISOString()}\n\n${accepted}`;
    const blob = new Blob([patch], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fixes-${item.taskId}.patch`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const acceptedCount = Object.values(taskFixes).filter((v) => v === 'accepted').length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            历史审查报告
          </h2>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            <div>任务 ID: {item.taskId}</div>
            <div>输入: {item.userInput}</div>
            <div>
              难度: {item.difficulty || 'N/A'} · 审查轮数: {item.reviewAuditCount} ·{' '}
              {new Date(item.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <Download size={14} /> 导出报告
          </button>
          {exportOpen && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 4, zIndex: 50, minWidth: 140,
              }}
            >
              {['Markdown', 'HTML'].map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt.toLowerCase())}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 12px', border: 'none', background: 'transparent',
                    color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {fmt}
                </button>
              ))}
              <button
                onClick={() => {
                  setExportOpen(false);
                  alert('PDF 导出：请使用 Cmd+P 打印为 PDF');
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', background: 'transparent',
                  color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
                  borderRadius: 4,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                PDF (Cmd+P)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Verdict */}
      {item.verdict && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 10,
          background: `${(VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).color}15`,
          border: `1px solid ${(VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).color}40`,
          marginBottom: 16,
        }}>
          {React.createElement((VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).icon, { size: 20, color: (VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).color })}
          <span style={{ fontSize: 15, fontWeight: 700, color: (VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).color }}>
            最终裁决：{(VERDICT_CONFIG[item.verdict as VerdictKey] || VERDICT_CONFIG.pass).label}
          </span>
        </div>
      )}

      {/* Pros */}
      {item.pros && item.pros.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-green)', marginBottom: 8 }}>
            ✅ 做得好的地方
          </h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {item.pros.map((p, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, padding: '4px 0 4px 16px', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: 'var(--accent-green)' }}>•</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Issues with Accept/Dismiss */}
      {item.issues && item.issues.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-red)', margin: 0 }}>
              ⚠️ 存在的问题（{item.issues.length}）
            </h3>
            {acceptedCount > 0 && (
              <button
                onClick={applyAllFixes}
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                应用所有修复（{acceptedCount}） &rarr;
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {item.issues.map((issue: any, i: number) => {
              const severity = issue.severity || 'low';
              const color = severity === 'high' ? 'var(--accent-red)'
                : severity === 'medium' ? 'var(--accent-orange)' : 'var(--accent-green)';
              const tag = severity === 'high' ? '高' : severity === 'medium' ? '中' : '低';
              const fixStatus = taskFixes[String(i)];

              return (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4,
                      background: `${color}25`, color, fontSize: 11, fontWeight: 600,
                      flexShrink: 0, marginTop: 2,
                    }}>{tag}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13, flex: 1, lineHeight: 1.5 }}>
                      {issue.desc}
                    </span>
                  </div>
                  {/* Fix suggestion */}
                  {issue.fixSuggestion && (
                    <div style={{
                      marginTop: 8, padding: '8px 12px', borderRadius: 6,
                      background: 'var(--bg-input)', fontSize: 12,
                      color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
                      whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    }}>
                      {issue.fixSuggestion}
                    </div>
                  )}
                  {/* Accept / Dismiss buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => store.setFixStatus(item.taskId, i, 'accepted')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 4,
                        border: '1px solid var(--accent-green)',
                        background: fixStatus === 'accepted' ? 'rgba(34,197,94,0.15)' : 'transparent',
                        color: fixStatus === 'accepted' ? 'var(--accent-green)' : 'var(--text-tertiary)',
                        fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      <Check size={12} /> Accept Fix
                    </button>
                    <button
                      onClick={() => store.setFixStatus(item.taskId, i, 'dismissed')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 4,
                        border: '1px solid var(--border)',
                        background: fixStatus === 'dismissed' ? 'rgba(155,155,155,0.1)' : 'transparent',
                        color: fixStatus === 'dismissed' ? 'var(--text-tertiary)' : 'var(--text-tertiary)',
                        fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      <X size={12} /> Dismiss
                    </button>
                    {fixStatus && (
                      <span style={{
                        fontSize: 11, padding: '4px 8px', borderRadius: 4,
                        background: fixStatus === 'accepted' ? 'rgba(34,197,94,0.1)' : 'rgba(155,155,155,0.1)',
                        color: fixStatus === 'accepted' ? 'var(--accent-green)' : 'var(--text-tertiary)',
                      }}>
                        {fixStatus === 'accepted' ? '已接受' : '已忽略'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {item.suggestions && item.suggestions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
            💡 修改建议
          </h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {item.suggestions.map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, padding: '4px 0 4px 16px', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: 'var(--accent)' }}>•</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary fallback if no detailed data */}
      {!item.verdict && !item.issues && !item.pros && !item.suggestions && (
        <div className="glass-card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>任务摘要</h3>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div><strong>摘要：</strong>{item.summary}</div>
            <div><strong>难度：</strong>{item.difficulty || 'N/A'}</div>
            <div><strong>审查轮数：</strong>{item.reviewAuditCount}</div>
            <div><strong>内容审核打回：</strong>{item.contentRejectCount}</div>
            <div><strong>代码审核打回：</strong>{item.codeRejectCount}</div>
            <div><strong>是否成功：</strong>{item.success ? '是' : '否'}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ Live Pipeline Review View (unchanged from original) ============
const LiveReviewView: React.FC<{ pipeline: PipelineState }> = ({ pipeline }) => {
  const rf = pipeline.reviewFramework;

  if (!rf) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
        <Shield size={48} color="var(--text-tertiary)" style={{ marginBottom: 16 }} />
        <h3 style={{ fontSize: 18, color: 'var(--text-secondary)', marginBottom: 8 }}>
          审查框架尚未启动
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          启动流水线后，中等/复杂任务将自动触发审查框架的三层深度审查。
        </p>
        <div style={{ marginTop: 24, textAlign: 'left', maxWidth: 480, margin: '24px auto 0' }}>
          <div className="glass-card" style={{ padding: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--accent)' }}>
              审查框架三层结构
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Layers size={16} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>准备层</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>信息提取 → 反向提取 → 轮次判定</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Users size={16} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>判定层</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>N 轮 × 3 审查员（逻辑/事实/用户）独立审查</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <FileText size={16} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>总结层</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>首席裁决官生成最终报告（做得好/问题/建议）</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const report = rf.finalReport;
  const verdictCfg = report ? VERDICT_CONFIG[report.verdict] : null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>审查框架详情</h2>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              {rf.triggerPoint === 'plan' ? '方案级审查' : '代码级兜底审计'} ·{' '}
              {rf.depth === 'full' ? '多轮深度' : '单轮'} ·{' '}
              难度：{rf.difficulty}
            </span>
          </div>
          <div style={{
            padding: '6px 14px',
            borderRadius: 8,
            background: rf.isRunning ? 'rgba(77,171,247,0.12)' : 'rgba(52,199,89,0.12)',
            color: rf.isRunning ? 'var(--accent)' : 'var(--accent-green)',
            fontSize: 13,
            fontWeight: 600,
          }}>
            {PHASE_LABELS[rf.phase] || rf.phase}
          </div>
        </div>
      </div>

      {/* 第一层：准备层 */}
      <Section title="第一层 · 准备层" icon={Layers}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card title="信息提取AI" content={rf.extraction || '未执行'} />
          <Card title="反向提取AI" content={rf.extraction2 || '未执行'} />
        </div>
        <Card title="判定能力AI（轮次判定）" content={rf.roundJudge || '未执行'} marginTop={12} />
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)' }}>
          → 判定需要 {rf.totalRounds} 轮审查
        </div>
      </Section>

      {/* 第二层：判定层 */}
      <Section title={`第二层 · 判定层（${rf.rounds.length}/${rf.totalRounds} 轮）`} icon={Users}>
        {rf.rounds.length === 0 ? (
          <Empty text="审查轮次尚未开始" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {rf.rounds.map((round) => (
              <RoundCard key={round.round} round={round} />
            ))}
          </div>
        )}
      </Section>

      {/* 第三层：总结层 */}
      <Section title="第三层 · 总结层（最终报告）" icon={FileText}>
        {!report ? (
          <Empty text="最终报告尚未生成" />
        ) : (
          <div>
            {verdictCfg && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px', borderRadius: 10,
                background: `${verdictCfg.color}15`,
                border: `1px solid ${verdictCfg.color}40`,
                marginBottom: 16,
              }}>
                <verdictCfg.icon size={20} color={verdictCfg.color} />
                <span style={{ fontSize: 15, fontWeight: 700, color: verdictCfg.color }}>
                  最终裁决：{verdictCfg.label}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  {report.totalRounds} 轮 · {report.totalElapsedMs}ms
                </span>
              </div>
            )}

            {report.pros.length > 0 && (
              <ReportBlock title="✅ 做得好的地方" color="var(--accent-green)" items={report.pros} />
            )}

            {report.issues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-red)', marginBottom: 10 }}>
                  ⚠️ 存在的问题（按严重程度）
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {report.issues.map((issue, i) => {
                    const color = issue.severity === 'high' ? 'var(--accent-red)'
                      : issue.severity === 'medium' ? 'var(--accent-orange)' : 'var(--accent-green)';
                    const tag = issue.severity === 'high' ? '高' : issue.severity === 'medium' ? '中' : '低';
                    return (
                      <div key={i} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(0,0,0,0.2)', fontSize: 13,
                      }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4,
                          background: `${color}25`, color, fontSize: 11, fontWeight: 600,
                          flexShrink: 0,
                        }}>{tag}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{issue.desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {report.suggestions.length > 0 && (
              <ReportBlock title="💡 修改建议" color="var(--accent)" items={report.suggestions} />
            )}
          </div>
        )}
      </Section>
    </div>
  );
};

// ============ Main component ============
const ReviewDetail: React.FC<ReviewDetailProps> = ({ pipeline, historyItem }) => {
  // If we have a history item, show the historical review view
  if (historyItem) {
    return <HistoryTaskView item={historyItem} />;
  }

  // Otherwise, show the live pipeline review
  return <LiveReviewView pipeline={pipeline} />;
};

// ============ 子组件 ============

const Section: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div style={{ marginBottom: 28 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <Icon size={16} color="var(--accent)" />
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
    </div>
    {children}
  </div>
);

const Card: React.FC<{ title: string; content: string; marginTop?: number }> = ({ title, content, marginTop }) => (
  <div className="glass-card" style={{ padding: 14, marginTop }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
    <pre style={{
      fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
      maxHeight: 200, overflowY: 'auto',
    }}>
      {content}
    </pre>
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
    {text}
  </div>
);

const ReviewerCard: React.FC<{ title: string; color: string; opinion: any }> = ({ title, color, opinion }) => {
  if (!opinion) return <Empty text={`${title}：未执行`} />;
  return (
    <div className="glass-card" style={{ padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{title}</span>
        <span style={{
          padding: '2px 8px', borderRadius: 4,
          background: `${color}20`, color, fontSize: 11, fontWeight: 700,
        }}>{opinion.score}/10</span>
      </div>
      <pre style={{
        fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
        maxHeight: 120, overflowY: 'auto',
      }}>
        {opinion.content.slice(0, 300)}{opinion.content.length > 300 ? '…' : ''}
      </pre>
      {opinion.keyIssues?.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color }}>
          核心问题：{opinion.keyIssues.join(' / ')}
        </div>
      )}
    </div>
  );
};

const RoundCard: React.FC<{ round: ReviewRound }> = ({ round }) => (
  <div className="glass-card" style={{ padding: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>第 {round.round} 轮审查</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          分歧度：{(round.divergenceDegree * 100).toFixed(0)}%
        </span>
        {round.needNextRound ? (
          <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>需继续</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--accent-green)' }}>可结束</span>
        )}
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
      <ReviewerCard title="逻辑严谨派" color="var(--accent)" opinion={round.reviewers.logic} />
      <ReviewerCard title="事实核查派" color="var(--accent-green)" opinion={round.reviewers.fact} />
      <ReviewerCard title="用户视角派" color="var(--accent-purple)" opinion={round.reviewers.user} />
    </div>
    <div style={{
      marginTop: 10, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(0,0,0,0.2)', fontSize: 11, color: 'var(--text-secondary)',
      whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto',
    }}>
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>阶段性总结：</span>
      {round.integration.slice(0, 200)}{round.integration.length > 200 ? '…' : ''}
    </div>
  </div>
);

const ReportBlock: React.FC<{ title: string; color: string; items: string[] }> = ({ title, color, items }) => (
  <div style={{ marginBottom: 16 }}>
    <h4 style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 10 }}>{title}</h4>
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {items.map((item, i) => (
        <li key={i} style={{
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7,
          padding: '4px 0 4px 16px', position: 'relative',
        }}>
          <span style={{ position: 'absolute', left: 0, color }}>•</span>
          {item}
        </li>
      ))}
    </ul>
  </div>
);

export default ReviewDetail;
