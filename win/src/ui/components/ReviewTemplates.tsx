import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface ReviewTemplatesProps {
  onSelectTemplate: (template: string) => void;
}

const PRESET_TEMPLATES = [
  {
    label: '安全审查',
    content: '请对此代码进行全面的安全审查，重点检查 SQL 注入、XSS、CSRF、权限绕过、敏感信息泄露',
  },
  {
    label: '性能审查',
    content: '请对此代码进行性能审查，关注算法复杂度、内存泄漏、不必要的重渲染、数据库查询效率',
  },
  {
    label: '代码规范',
    content: '请按 TypeScript/React 最佳实践审查此代码，检查命名规范、类型安全、组件拆分合理性',
  },
  {
    label: 'SQL 注入检查',
    content: '专门审查 SQL 相关代码，检查所有查询是否使用参数化查询',
  },
  {
    label: '依赖审查',
    content: '审查 package.json 依赖，检查已知漏洞、过期版本、不必要的依赖',
  },
];

const CUSTOM_KEY = 'hank_review_templates';

const ReviewTemplates: React.FC<ReviewTemplatesProps> = ({ onSelectTemplate }) => {
  const [open, setOpen] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<Array<{ label: string; content: string }>>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newContent, setNewContent] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const allTemplates = [...PRESET_TEMPLATES, ...customTemplates];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddCustom = () => {
    if (!newLabel.trim() || !newContent.trim()) return;
    const updated = [...customTemplates, { label: newLabel.trim(), content: newContent.trim() }];
    setCustomTemplates(updated);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(updated));
    setNewLabel('');
    setNewContent('');
    setShowAdd(false);
  };

  const handleDeleteCustom = (idx: number) => {
    const updated = customTemplates.filter((_, i) => i !== idx);
    setCustomTemplates(updated);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(updated));
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 150ms',
        }}
      >
        模板
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            width: 320,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {allTemplates.map((t, i) => {
              const isPreset = i < PRESET_TEMPLATES.length;
              return (
                <div
                  key={t.label + i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    onSelectTemplate(t.content);
                    setOpen(false);
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
                      {t.content.length > 50 ? t.content.slice(0, 50) + '...' : t.content}
                    </div>
                  </div>
                  {!isPreset && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCustom(i - PRESET_TEMPLATES.length);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-tertiary)',
                        cursor: 'pointer',
                        fontSize: 14,
                        padding: '2px 6px',
                        flexShrink: 0,
                      }}
                      title="删除自定义模板"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Custom template section */}
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {showAdd ? (
              <div style={{ padding: '12px 14px' }}>
                <input
                  placeholder="模板名称..."
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    marginBottom: 8,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                  }}
                />
                <textarea
                  placeholder="模板内容..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    marginBottom: 8,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleAddCustom}
                    className="btn btn-primary"
                    style={{ fontSize: 12, padding: '4px 14px' }}
                  >
                    添加
                  </button>
                  <button
                    onClick={() => setShowAdd(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-tertiary)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'inherit',
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                + 添加自定义模板
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewTemplates;
