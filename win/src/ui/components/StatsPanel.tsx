import React from 'react';
import type { HistoryItem } from '../../store/appStore';

interface StatsPanelProps {
  history: HistoryItem[];
}

const StatsPanel: React.FC<StatsPanelProps> = ({ history }) => {
  const total = history.length;
  if (total === 0) return null;

  const passed = history.filter((h) => h.verdict === 'pass').length;
  const conditional = history.filter((h) => h.verdict === 'conditional').length;
  const rejected = history.filter((h) => h.verdict === 'reject').length;
  const passRate = total > 0 ? Math.round(((passed + conditional) / total) * 100) : 0;

  // Difficulty distribution
  const simple = history.filter((h) => h.difficulty === 'simple').length;
  const medium = history.filter((h) => h.difficulty === 'medium').length;
  const complex = history.filter((h) => h.difficulty === 'complex').length;

  // Last 7 days trend
  const now = Date.now();
  const dayLabels: string[] = [];
  const dayCounts: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * 86400000);
    dayLabels.push(`${day.getMonth() + 1}/${day.getDate()}`);
    const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const endOfDay = startOfDay + 86400000;
    dayCounts.push(
      history.filter((h) => {
        const t = new Date(h.createdAt).getTime();
        return t >= startOfDay && t < endOfDay;
      }).length,
    );
  }

  const maxCount = Math.max(...dayCounts, 1);
  const difficultyTotal = simple + medium + complex || 1;

  const pieSegments = [
    { label: '简单', value: simple, color: 'var(--accent-green)' },
    { label: '中等', value: medium, color: 'var(--accent-orange)' },
    { label: '复杂', value: complex, color: 'var(--accent-purple)' },
  ].filter((s) => s.value > 0);

  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
        审查统计
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {/* Summary cards */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>总审查次数</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)' }}>{total}</div>
        </div>
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>通过率</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent-green)' }}>{passRate}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
            通过 {passed} · 有条件 {conditional} · 拒绝 {rejected}
          </div>
        </div>

        {/* Pie chart (CSS) */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>难度分布</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: `conic-gradient(${pieSegments
                  .map((s, i, arr) => {
                    const prev = arr.slice(0, i).reduce((sum, x) => sum + x.value, 0);
                    const start = (prev / difficultyTotal) * 360;
                    const end = ((prev + s.value) / difficultyTotal) * 360;
                    return `${s.color} ${start}deg ${end}deg`;
                  })
                  .join(', ')})`,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pieSegments.map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bar chart (CSS) */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>近 7 天趋势</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {dayCounts.map((count, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{count}</span>
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max((count / maxCount) * 60, 2)}px`,
                    background: count > 0 ? 'var(--accent)' : 'var(--border)',
                    borderRadius: '3px 3px 0 0',
                    transition: 'height 300ms',
                  }}
                />
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{dayLabels[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsPanel;
