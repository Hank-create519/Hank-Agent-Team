import React, { useState, useEffect } from 'react';
import { GitBranch, Loader, CheckSquare, Square } from 'lucide-react';

interface GitPanelProps {
  onStartReview: (userInput: string) => void;
}

interface ChangedFile {
  path: string;
  checked: boolean;
}

const GitPanel: React.FC<GitPanelProps> = ({ onStartReview }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [diffs, setDiffs] = useState<Record<string, string>>({});

  const scanGit = async () => {
    setLoading(true);
    setError('');
    try {
      // Use shell_executor via fetch or direct import isn't available
      // In Electron, use IPC or child_process via preload
      const win = window as any;
      if (win.electronAPI?.exec) {
        const result = await win.electronAPI.exec('git diff --name-only');
        const fileList = result
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((path: string) => ({ path, checked: true }));
        setFiles(fileList);
      } else {
        setError('未检测到 Electron 环境，无法执行 git 命令');
      }
    } catch (e: any) {
      setError(e.message || 'Git 命令执行失败');
    } finally {
      setLoading(false);
    }
  };

  const toggleFile = (idx: number) => {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, checked: !f.checked } : f)));
  };

  const startReview = async () => {
    const selected = files.filter((f) => f.checked);
    if (selected.length === 0) return;

    const win = window as any;
    if (!win.electronAPI?.exec) {
      setError('未检测到 Electron 环境');
      return;
    }

    setLoading(true);
    const diffContents: string[] = [];
    for (const file of selected) {
      try {
        const diff = await win.electronAPI.exec(`git diff ${file.path}`);
        diffContents.push(`## ${file.path}\n\`\`\`diff\n${diff}\n\`\`\``);
      } catch (e) {
        diffContents.push(`## ${file.path}\n[获取 diff 失败]`);
      }
    }
    setLoading(false);

    const prompt = `请审查以下 Git 变更：\n\n${diffContents.join('\n\n')}`;
    onStartReview(prompt);
    setOpen(false);
  };

  return (
    <div>
      <button
        onClick={() => { setOpen(!open); if (!open) scanGit(); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <GitBranch size={14} />
        Git 审查
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 8,
              width: 420,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 20,
              zIndex: 100,
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Git 审查</h3>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              选择要审查的变更文件
            </p>

            {loading && !files.length && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20 }}>
                <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> 扫描中...
              </div>
            )}

            {error && (
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 8, color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>
                {error}
              </div>
            )}

            {files.length > 0 && (
              <div style={{ maxHeight: 300, overflow: 'auto', marginBottom: 16 }}>
                {files.map((f, i) => (
                  <div
                    key={f.path}
                    onClick={() => toggleFile(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      color: f.checked ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {f.checked ? (
                      <CheckSquare size={14} color="var(--accent)" />
                    ) : (
                      <Square size={14} />
                    )}
                    {f.path}
                  </div>
                ))}
              </div>
            )}

            {files.length > 0 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={startReview}
                  disabled={loading || !files.some((f) => f.checked)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: 'var(--accent)', color: '#fff', fontSize: 12,
                    cursor: files.some((f) => f.checked) ? 'pointer' : 'not-allowed',
                    opacity: files.some((f) => f.checked) ? 1 : 0.5,
                    fontFamily: 'inherit',
                  }}
                >
                  开始审查 ({files.filter((f) => f.checked).length})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default GitPanel;
