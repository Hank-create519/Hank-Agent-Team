import React, { useState, useRef, useEffect } from 'react';
import { ArrowUp, Square, Plus } from 'lucide-react';
import { ChatMessage, PipelineState, PipelineStage } from '../../core/types';
import { sendChatMessage, pause, resume, stop, STAGE_LABELS } from '../../core/Engine';

interface ChatPanelProps { pipeline: PipelineState; }

const ChatPanel: React.FC<ChatPanelProps> = ({ pipeline }) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [pipeline.chatMessages?.length ?? 0, busy]);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const send = async () => {
    if (!input.trim() || busy) return;
    setBusy(true); const msg = input; setInput('');
    try { await sendChatMessage(msg); } finally { setBusy(false); }
  };

  const messages = pipeline.chatMessages || [];
  const running = pipeline.isRunning;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* 顶栏 */}
      <header style={{
        height: 44, borderBottom: '1px solid var(--border)', paddingLeft: 20, paddingRight: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-tertiary)' }}>hank-agent-team</span>
          {pipeline.difficulty && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
              · {pipeline.difficulty}
            </span>
          )}
        </div>
        {running && (
          <div style={{ display: 'flex', gap: 6 }}>
            <MiniBtn onClick={() => pipeline.paused ? resume() : pause()}>
              {pipeline.paused ? 'resume' : 'pause'}
            </MiniBtn>
            <MiniBtn danger onClick={() => stop()}>stop</MiniBtn>
          </div>
        )}
      </header>

      {/* 消息流 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
        {messages.length === 0 ? (
          <EmptyState onPick={(s) => setInput(s)} />
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
            {messages.map((m: ChatMessage) => <MsgRow key={m.id} msg={m} />)}
            {busy && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-tertiary)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>command</span>
                <span className="dot-loader"><span /><span /><span /></span>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: '12px 24px 16px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '10px 12px', transition: 'border-color .15s',
          }}>
            {running && (
              <button onClick={() => stop()} title="终止任务" style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--danger)',
                display: 'flex', flexShrink: 0,
              }}><Square size={14} fill="currentColor" /></button>
            )}
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={running ? '补充需求或提问…' : '描述你要做什么…'}
              rows={1}
              style={{
                flex: 1, resize: 'none', background: 'none', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', lineHeight: 1.5,
                maxHeight: 160,
              }}
            />
            <button onClick={send} disabled={!input.trim() || busy} style={{
              width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
              background: input.trim() && !busy ? 'var(--accent)' : 'var(--border)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s', flexShrink: 0,
            }}><ArrowUp size={15} /></button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, fontFamily: 'var(--mono)', textAlign: 'center' }}>
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ onPick: (s: string) => void }> = ({ onPick }) => (
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 6 }}>
      <span style={{ color: 'var(--accent)' }}>$</span> hank-agent-team ready
    </div>
    <h2 style={{ fontSize: 22, fontWeight: 600, marginTop: 16, marginBottom: 8, letterSpacing: '-0.02em' }}>
      有什么可以帮你？
    </h2>
    <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360, textAlign: 'center', lineHeight: 1.7, marginBottom: 28 }}>
      和指挥队长对话，描述你的任务。我会评估难度、调度四部门协作，全程你可以随时补充或暂停。
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 360 }}>
      {[
        '帮我设计一个支持多 Agent 协作的系统架构',
        '写一个 React 状态管理 hook',
        '审查一下这个方案的逻辑漏洞',
      ].map(s => (
        <button key={s} onClick={() => onPick(s)} style={{
          textAlign: 'left', padding: '10px 14px', borderRadius: 8,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', transition: 'all .15s',
          fontFamily: 'inherit',
        }}>{s}</button>
      ))}
    </div>
  </div>
);

const MsgRow: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const isUser = msg.role === 'user';
  return (
    <div className="slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* 角色标签 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
          color: isUser ? 'var(--text-secondary)' : 'var(--accent)',
        }}>{isUser ? 'user' : msg.name === '指挥队长' ? 'command' : msg.name}</span>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {/* 内容 */}
      <div style={{
        fontSize: 14, lineHeight: 1.75, color: 'var(--text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        paddingLeft: 0,
      }}>
        {formatContent(msg.content)}
        {msg.action && (
          <ActionBadge type={msg.action.type} />
        )}
      </div>
    </div>
  );
};

// 格式化内容（简单 markdown 处理）
function formatContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('```')) return null;
    if (line.startsWith('# ')) return <div key={i} style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>{line.slice(2)}</div>;
    if (line.startsWith('## ')) return <div key={i} style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: 'var(--text)' }}>{line.slice(3)}</div>;
    if (line.startsWith('- ') || line.startsWith('• ')) return <div key={i} style={{ paddingLeft: 12, color: 'var(--text-secondary)' }}>· {line.slice(2)}</div>;
    return <div key={i}>{line || '\u00A0'}</div>;
  });
}

const ActionBadge: React.FC<{ type: string }> = ({ type }) => {
  const labels: Record<string, string> = {
    start_pipeline: '▶ 启动流水线', supplement: '＋ 补充需求', pause: '⏸ 暂停',
    resume: '▶ 恢复', stop: '⏹ 终止', redirect: '↻ 重新评估', query_dept: '→ 穿透提问',
  };
  return (
    <span style={{
      display: 'inline-block', marginLeft: 8, padding: '1px 8px', borderRadius: 4,
      background: 'var(--accent-dim)', color: 'var(--accent)',
      fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 500, verticalAlign: 'middle',
    }}>{labels[type] || type}</span>
  );
};

const MiniBtn: React.FC<{ children: React.ReactNode; onClick: () => void; danger?: boolean }> = ({ children, onClick, danger }) => (
  <button onClick={onClick} style={{
    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--mono)',
    background: 'transparent', border: '1px solid var(--border)',
    color: danger ? 'var(--danger)' : 'var(--text-tertiary)', cursor: 'pointer', transition: 'all .15s',
  }}>{children}</button>
);

export default ChatPanel;
