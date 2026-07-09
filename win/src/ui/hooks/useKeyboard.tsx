import React, { useEffect, useRef, useState, useCallback } from 'react';

interface UseKeyboardOptions {
  onSubmitInput: () => void;
  onToggleRightPanel: () => void;
  onClosePanel: () => void;
  onNavigatePage: (index: number) => void;
}

export function useKeyboard({
  onSubmitInput,
  onToggleRightPanel,
  onClosePanel,
  onNavigatePage,
}: UseKeyboardOptions) {
  // 命令面板快捷键提示按平台显示 ⌘(macOS) / Ctrl(Win/Linux)
  const isMac =
    typeof window !== 'undefined' && (window as any).electronAPI?.platform === 'darwin';
  const mod = isMac ? '⌘' : 'Ctrl';
  const [commandPalette, setCommandPalette] = useState<React.ReactNode>(null);
  const paletteRef = useRef(false);

  const showCommandPalette = useCallback(() => {
    paletteRef.current = true;
    setCommandPalette(
      <div
        style={{
          position: 'fixed',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -30%)',
          zIndex: 1000,
          width: 360,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)' }}>
          命令面板
        </div>
        {[
          { label: '总览', keys: `${mod}1`, action: () => onNavigatePage(0) },
          { label: '流水线', keys: `${mod}2`, action: () => onNavigatePage(1) },
          { label: '审查详情', keys: `${mod}3`, action: () => onNavigatePage(2) },
          { label: '监控', keys: `${mod}4`, action: () => onNavigatePage(3) },
          { label: '团队', keys: `${mod}5`, action: () => onNavigatePage(4) },
          { label: '切换右侧面板', keys: `${mod}K`, action: onToggleRightPanel },
          { label: '执行审查', keys: `${mod}Enter`, action: onSubmitInput },
        ].map((cmd) => (
          <div
            key={cmd.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text-primary)',
              borderBottom: '1px solid var(--border)',
            }}
            onClick={() => {
              cmd.action();
              closePalette();
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-card-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <span>{cmd.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {cmd.keys}
            </span>
          </div>
        ))}
      </div>
    );
  }, [onSubmitInput, onToggleRightPanel, onNavigatePage]);

  const closePalette = useCallback(() => {
    paletteRef.current = false;
    setCommandPalette(null);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+Shift+P: Command palette
      if (isMeta && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        if (!paletteRef.current) showCommandPalette();
        else closePalette();
        return;
      }

      // Close palette or right panel with Escape
      if (e.key === 'Escape') {
        if (paletteRef.current) {
          closePalette();
          return;
        }
        onClosePanel();
        return;
      }

      // Cmd+K: Toggle right panel
      if (isMeta && e.key === 'k') {
        e.preventDefault();
        onToggleRightPanel();
        return;
      }

      // Cmd+1~5: Navigate pages
      if (isMeta && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        onNavigatePage(parseInt(e.key) - 1);
        return;
      }

      // Cmd+Enter: Submit input
      if (isMeta && e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'TEXTAREA') {
          e.preventDefault();
          onSubmitInput();
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSubmitInput, onToggleRightPanel, onClosePanel, onNavigatePage, showCommandPalette, closePalette]);

  // Overlay to close palette on outside click
  const paletteWithOverlay = commandPalette ? (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'rgba(0,0,0,0.3)',
        }}
        onClick={closePalette}
      />
      {commandPalette}
    </>
  ) : null;

  return { commandPalette: paletteWithOverlay };
}
