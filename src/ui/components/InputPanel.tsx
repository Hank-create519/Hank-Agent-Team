import React, { useState, useRef, useEffect, useCallback } from 'react';

type Mode = 'Code Review' | 'Security Audit' | 'Full Pipeline';

interface InputPanelProps {
  onSubmit: (text: string, mode: string) => void;
  history: { userInput: string; mode: string }[];
}

const MODES: Mode[] = ['Code Review', 'Security Audit', 'Full Pipeline'];

const InputPanel: React.FC<InputPanelProps> = ({ onSubmit, history }) => {
  const [mode, setMode] = useState<Mode>('Code Review');
  const [modeOpen, setModeOpen] = useState(false);
  const [text, setText] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- Auto-resize textarea ----
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // ---- Submit ----
  const handleSubmit = useCallback(() => {
    if (!text.trim()) return;
    onSubmit(text, mode);
    setText('');
  }, [text, mode, onSubmit]);

  // ---- Keyboard ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          handleSubmit();
        } else if (!e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      }
    },
    [handleSubmit],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '10px 12px',
        gap: 8,
      }}
    >
      {/* ---- Mode Dropdown ---- */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setModeOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '5px 10px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <span>{mode}</span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>&#x25BE;</span>
        </button>
        {modeOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 2,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              zIndex: 10,
              overflow: 'hidden',
            }}
          >
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setModeOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 10px',
                  background: m === mode ? 'var(--accent-dim)' : 'transparent',
                  border: 'none',
                  color: m === mode ? 'var(--accent)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- Text Input ---- */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="$ paste or type..."
        rows={3}
        style={{
          flex: 1,
          padding: '10px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.6,
          resize: 'none',
          outline: 'none',
          minHeight: 80,
        }}
      />

      {/* ---- Footer: shortcut hint + submit ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-tertiary)',
          }}
        >
          &#x2318;Enter to submit
        </span>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="btn-primary"
          style={{ fontSize: 11, padding: '5px 12px' }}
        >
          Run
        </button>
      </div>

      {/* ---- History ---- */}
      {history.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 8,
          }}
        >
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform .15s',
                fontSize: 10,
              }}
            >
              &#x25B8;
            </span>
            History ({history.length})
          </button>
          {historyOpen && (
            <div
              style={{
                marginTop: 6,
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {history.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setText(h.userInput);
                    setMode(h.mode as Mode);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '4px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--bg-input)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <span style={{ color: 'var(--accent)', marginRight: 6, fontSize: 10 }}>
                    [{h.mode.split(' ')[0]}]
                  </span>
                  {h.userInput.slice(0, 60)}
                  {h.userInput.length > 60 ? '...' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InputPanel;
