// ============================================================
// 用户穿透监控模块
// 对齐提示词"用户可穿透"原则：
//   - 全程可监控（当前走到哪个部门、哪个阶段）
//   - 单点透传提问（对任意部门单独提问）
//   - 中途干预（暂停/恢复/补充需求）
// ============================================================

import type { PipelineState, Department, MonitorEvent } from '../core/types';
import { queryDepartment } from '../core/Engine';

// 部门中文描述
const DEPT_DESC: Record<Department, { name: string; desc: string }> = {
  command: { name: '指挥部', desc: '决策与总控核心，负责难度分流、任务下发、终审交付' },
  info: { name: '信息部', desc: '情报与数据触角，负责检索、整理、标注可信度' },
  develop: { name: '开发部', desc: '核心执行部门，负责编码、自检、部署' },
  review: { name: '审核部', desc: '质量把关人，含审查框架三大审查员（逻辑/事实/用户）' },
};

// 生成当前进度报告（用户询问进度时调用）
export function getProgressReport(state: PipelineState): string {
  if (!state.isRunning && state.stage === 'done') {
    return `✅ 任务已完成交付。
- 难度档位：${state.difficulty || '未知'}
- 审查框架执行：${state.reviewAuditCount} 次
- 内容审核打回：${state.contentRejectCount} 次
- 代码审核打回：${state.codeRejectCount} 次`;
  }

  if (!state.isRunning && !state.taskId) {
    return '⚪ 当前无运行中的任务。请在总览页输入需求启动流水线。';
  }

  const stageLabel: Record<string, string> = {
    difficulty_assess: '难度评估（指挥部）',
    init: '制定方案（指挥部）',
    audit_entry: '审查框架把关（审核部）',
    extract: '信息提取（信息部）',
    content_review: '内容审核（审核部）',
    develop: '开发编码（开发部）',
    code_review: '代码审核（审核部）',
    deep_audit: '系统级深度审计（审核部）',
    deploy: '部署上线（开发部）',
    done: '完成交付（指挥部）',
  };

  const lines: string[] = [];
  lines.push(`🔄 任务运行中（进度 ${state.progress}%）`);
  lines.push(`- 当前阶段：${stageLabel[state.stage] || state.stage}`);
  lines.push(`- 难度档位：${state.difficulty || '评估中'}`);

  // 运行中的 Agent
  const runningAgents = state.agents.filter((a) => a.status === 'running');
  if (runningAgents.length > 0) {
    lines.push(`- 工作中的 Agent：${runningAgents.map((a) => `${a.name}(${a.currentTask})`).join('、')}`);
  }

  if (state.reviewFramework?.isRunning) {
    lines.push(`- 审查框架：${state.reviewFramework.phase}（第 ${state.reviewFramework.rounds.length}/${state.reviewFramework.totalRounds} 轮）`);
  }

  if (state.paused) {
    lines.push(`- ⏸️ 已暂停（可继续）`);
  }

  return lines.join('\n');
}

// 单点透传提问（切换到对应部门视角回答）
export async function askDepartment(
  dept: Department,
  question: string,
): Promise<string> {
  const info = DEPT_DESC[dept];
  const answer = await queryDepartment(dept, question);
  return `【${info.name} 回答】\n\n${answer}`;
}

// 获取可干预的暂停点
export function getInterventionPoints(state: PipelineState): string[] {
  const points: string[] = [];
  if (state.paused) {
    points.push('当前已暂停，可点击"继续"恢复');
  }
  if (state.contentRejectCount >= 2) {
    points.push(`内容审核已打回 ${state.contentRejectCount} 次（即将触发暂停阈值）`);
  }
  if (state.codeRejectCount >= 2) {
    points.push(`代码审核已打回 ${state.codeRejectCount} 次（即将触发暂停阈值）`);
  }
  if (state.reviewFramework?.finalReport?.verdict === 'reject') {
    points.push('审查框架驳回了上一版产出，等待重新执行');
  }
  return points;
}

// 获取监控事件流（按类型过滤）
export function filterMonitorEvents(
  events: MonitorEvent[],
  type?: MonitorEvent['type'],
  dept?: Department,
): MonitorEvent[] {
  return events.filter((e) => {
    if (type && e.type !== type) return false;
    if (dept && e.department !== dept) return false;
    return true;
  });
}

// 导出部门描述（供 UI 使用）
export { DEPT_DESC };
