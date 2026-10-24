// ============================================================
// Chat Intent Router（V2.2 步骤⑨）
// 把 ChatPanel 的输入分类为：进度查询 / 部门提问 / 任务控制 / 新任务指引。
// 第一版为规则分类；LLM 分类留待后续（接口不变）。
// ============================================================

import { getState, queryDepartment, pause, resume, stop } from './Engine';
import { getProgressReport } from './Monitor';
import type { Department } from './types';

const DEPT_WORDS: Array<[RegExp, Department]> = [
  [/指挥部/, 'command'],
  [/信息部/, 'info'],
  [/开发部/, 'develop'],
  [/审核部/, 'review'],
];

export type ChatIntent =
  | { type: 'progress' }
  | { type: 'dept', dept: Department }
  | { type: 'control', action: 'pause' | 'resume' | 'stop' }
  | { type: 'new-task' };

export function classifyIntent(text: string): ChatIntent {
  const t = text.trim();

  if (/^(暂停|先停一下)$/.test(t)) return { type: 'control', action: 'pause' };
  if (/^(继续|恢复)$/.test(t)) return { type: 'control', action: 'resume' };
  if (/^(停止|取消任务|终止)$/.test(t)) return { type: 'control', action: 'stop' };

  if (/进度|到哪|进行到|状态|还要多久/.test(t)) return { type: 'progress' };

  if (/^(暂停|继续|恢复|停止)/.test(t)) {
    for (const [re, dept] of DEPT_WORDS) {
      if (re.test(t)) return { type: 'dept', dept };
    }
  }

  for (const [re, dept] of DEPT_WORDS) {
    if (re.test(t)) return { type: 'dept', dept };
  }

  return { type: 'new-task' };
}

/** 处理一条聊天消息，返回给用户的回复文本 */
export async function handleChatMessage(text: string): Promise<string> {
  const intent = classifyIntent(text);

  switch (intent.type) {
    case 'progress':
      return getProgressReport(getState());

    case 'control': {
      if (intent.action === 'pause') { pause(); return '已暂停。点「继续」或对我说"继续"即可恢复。'; }
      if (intent.action === 'resume') { resume(); return '已恢复执行。'; }
      stop();
      return '任务已停止。';
    }

    case 'dept': {
      const names: Record<Department, string> = { command: '指挥部', info: '信息部', develop: '开发部', review: '审核部' };
      return `【${names[intent.dept]} 回答】\n\n` + await queryDepartment(intent.dept, text);
    }

    case 'new-task':
    default:
      return '收到，这看起来是一个新任务。\n请到「总览」页把完整需求填入任务卡提交——那里会走完整的流水线（难度评估 → 方案 → 审查 → 交付）。\n\n你也可以在这里：\n· 询问进度（"现在到哪了？"）\n· 向某个部门提问（"问开发部：xxx"）\n· 控制任务（"暂停" / "继续" / "停止"）';
  }
}
