import React, { useState } from 'react';
import { PipelineState, Department } from '../../core/types';
import { Activity, Send, Radio } from 'lucide-react';
import { askDepartment, getProgressReport, getInterventionPoints, DEPT_DESC } from '../../core/Monitor';

interface MonitorPageProps {
  pipeline: PipelineState;
}

const DEPTS: Department[] = ['command', 'info', 'develop', 'review'];

const MonitorPage: React.FC<MonitorPageProps> = ({ pipeline }) => {
  const [selectedDept, setSelectedDept] = useState<Department>('review');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const progressReport = getProgressReport(pipeline);
  const interventionPoints = getInterventionPoints(pipeline);

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer('');
    try {
      const result = await askDepartment(selectedDept, question);
      setAnswer(result);
    } catch (e: any) {
      setAnswer(`查询失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>穿透监控</h2>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          全程监控流水线状态，可对任意部门单点提问
        </span>
      </div>

      {/* 进度报告 */}
      <div className="glass-card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Activity size={16} color="var(--accent)" />
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>当前进度</h3>
        </div>
        <pre style={{
          fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap', fontFamily: 'inherit',
        }}>
          {progressReport}
        </pre>
      </div>

      {/* 干预点提示 */}
      {interventionPoints.length > 0 && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-orange)', marginBottom: 6 }}>
            ⚠️ 可干预点
          </div>
          {interventionPoints.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>· {p}</div>
          ))}
        </div>
      )}

      {/* 单点提问 */}
      <div className="glass-card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Radio size={16} color="var(--accent)" />
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>单点透传提问</h3>
        </div>

        {/* 部门选择 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {DEPTS.map((dept) => {
            const info = DEPT_DESC[dept];
            const active = selectedDept === dept;
            return (
              <button
                key={dept}
                onClick={() => setSelectedDept(dept)}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  background: active ? 'rgba(77,171,247,0.15)' : 'var(--bg-card)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 200ms var(--spring)',
                }}
              >
                {info.name}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
          {DEPT_DESC[selectedDept].desc}
        </div>

        {/* 提问输入 */}
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="glass-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder={`向${DEPT_DESC[selectedDept].name}提问，例如："你觉得最大的问题是什么？"`}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleAsk}
            disabled={!question.trim() || loading}
            style={{ flexShrink: 0 }}
          >
            {loading ? (
              <span className="dot-loader"><span /><span /><span /></span>
            ) : (
              <><Send size={14} /> 提问</>
            )}
          </button>
        </div>

        {/* 回答 */}
        {answer && (
          <div style={{
            marginTop: 14, padding: 14, borderRadius: 10,
            background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)',
          }}>
            <pre style={{
              fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
            }}>
              {answer}
            </pre>
          </div>
        )}
      </div>

      {/* 监控事件流 */}
      <div className="glass-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>监控事件流</h3>
        {pipeline.monitorEvents.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            暂无监控事件
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
            {pipeline.monitorEvents.slice().reverse().map((evt) => (
              <div key={evt.id} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(0,0,0,0.2)', fontSize: 12,
              }}>
                <span style={{
                  padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                  background: 'var(--bg-card-hover)', color: 'var(--text-tertiary)',
                  fontSize: 10,
                }}>
                  {new Date(evt.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
                  {evt.agentName}
                </span>
                <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{evt.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* P2-11: Agent 对话流 */}
      <div className="glass-card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Send size={16} color="var(--accent-green)" />
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>对话流</h3>
        </div>
        {pipeline.messages && pipeline.messages.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pipeline.messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.2)',
                  fontSize: 12,
                }}
              >
                <span style={{
                  padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                  background: 'rgba(16,163,127,0.15)', color: 'var(--accent)',
                  fontSize: 10, fontWeight: 600,
                }}>
                  {new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
                  {msg.agentName || msg.agentId}
                </span>
                <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{msg.department}</span>
                {msg.type === 'dept_message' && (
                  <>
                    <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{msg.message}</span>
                  </>
                )}
                {msg.type !== 'dept_message' && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 4,
                    background: `var(--bg-card-hover)`, color: 'var(--text-tertiary)',
                    fontSize: 10,
                  }}>
                    {msg.type}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '16px 0', textAlign: 'center' }}>
            暂无对话记录
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitorPage;
