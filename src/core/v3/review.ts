// ============================================================
// v3 审查服务：把“固定三层”改造成“策略驱动的可调用能力”。
//
//   quick    ：单审查员 1 次调用（便宜，用于低风险/代码快审）
//   standard ：正向提取 + 2 审查员（quorum）
//   panel    ：正反提取 + 轮次判定 + 3 审查员（divergence）+ 裁决
//
// 保留的诚实规则：
//   1) 任一调用降级（demo/failed）→ verdict 最高 conditional
//   2) 解析失败/无明确通过 → default-deny（reject/conditional）
//   3) 高风险 finding 阻止 pass
// ============================================================

import type { Agent, ModelConfig } from '../types';
import type { GateResult, ReviewFinding, ReviewPolicy, ReviewVerdict } from './types';
import { invokeLLM, type InvokeBudget } from './invoke';
import { agentRouter, type RouteDecision } from './agentRouter';
import { REVIEWER_PROMPTS } from '../ReviewFramework';
import { parseReviewResult } from '../utils/review-parse';
import { safeJsonParse } from '../llm';


export const REVIEW_POLICIES: Record<string, ReviewPolicy> = {
  quick: {
    id: 'quick',
    maxCalls: 3,
    preparation: { forwardExtract: false, reverseExtract: false, judgeRounds: false },
    panel: [{ role: 'reviewer_logic', promptKey: 'reviewer_logic' }],
    consensus: { mode: 'single', threshold: 0.5, minRounds: 1, maxRounds: 1 },
    verdict: { defaultDeny: true, blockOnSeverity: 'high' },
    escalation: { onRoundLimit: 'pause' },
  },
  standard: {
    id: 'standard',
    maxCalls: 7,
    preparation: { forwardExtract: true, reverseExtract: false, judgeRounds: true },
    panel: [
      { role: 'reviewer_logic', promptKey: 'reviewer_logic' },
      { role: 'reviewer_fact', promptKey: 'reviewer_fact' },
    ],
    consensus: { mode: 'quorum', threshold: 0.5, minRounds: 1, maxRounds: 2 },
    verdict: { defaultDeny: true, blockOnSeverity: 'high' },
    escalation: { onRoundLimit: 'pause' },
  },
  panel: {
    id: 'panel',
    maxCalls: 12,
    preparation: { forwardExtract: true, reverseExtract: true, judgeRounds: true },
    panel: [
      { role: 'reviewer_logic', promptKey: 'reviewer_logic' },
      { role: 'reviewer_fact', promptKey: 'reviewer_fact' },
      { role: 'reviewer_user', promptKey: 'reviewer_user' },
    ],
    consensus: { mode: 'divergence', threshold: 0.5, minRounds: 1, maxRounds: 3 },
    verdict: { defaultDeny: true, blockOnSeverity: 'high' },
    escalation: { onRoundLimit: 'pause' },
  },
};

export interface ReviewRequest {
  targetLabel: string;
  targetContent: string;
  policyId: string;
  agents: Agent[];
  models: ModelConfig[];
  demo: boolean;
  signal?: AbortSignal;
  /** 统一预算（任务级 + 节点级） */
  budget?: InvokeBudget;
  /** 调用上下文：taskId/nodeId 用于审计归属 */
  context: { taskId: string; nodeId: string };
  onProgress?: (phase: string, detail?: string) => void;
}

export interface ReviewOutcome {
  gate: GateResult;
  reportText: string;
  /** 本次审查出现的全部调用 auditId（供节点级审计） */
  auditIds: string[];
  /** 审查员路由记录（供审计/调试） */
  routes: RouteDecision[];
}

/**
 * 通过 AgentRouter 选择审查员：
 * 先按角色精确路由；若该角色无可用 Agent（例如未配 Key 且 demo 模式），退回审核部成员。
 * 跨部门代办时标记 crossDepartment，由引擎写审计事件。
 */
function routeReviewer(
  req: ReviewRequest,
  role: Agent['role'],
  routes: RouteDecision[],
): Agent | undefined {
  try {
    const decision = agentRouter.route({
      department: 'review',
      capability: 'review',
      agents: req.agents,
      runMode: req.demo ? 'demo' : 'live',
      preferredRoles: [role],
    });
    routes.push(decision);
    return decision.agent;
  } catch {
    return undefined;
  }
}

function reviewerUserPrompt(label: string, content: string, extra: string): string {
  return `请审核以下${label}：\n\n${content}\n\n${extra}\n\n【输出要求】先给出审核分析；最后一行输出 JSON：{"result":"approved"或"rejected","issues":["问题1","问题2"]}`;
}

function findingsFromIssues(issues: string[]): ReviewFinding[] {
  return issues.slice(0, 6).map(text => ({
    severity: /严重|高危|漏洞|越权|泄露|注入|崩溃/.test(text) ? 'high' : 'medium',
    desc: text.trim().slice(0, 200),
  }) as ReviewFinding);
}

function maxSeverity(findings: ReviewFinding[]): 'high' | 'medium' | 'low' {
  if (findings.some(f => f.severity === 'high')) return 'high';
  if (findings.some(f => f.severity === 'medium')) return 'medium';
  return 'low';
}

function severityRank(sev: 'high' | 'medium' | 'low'): number {
  return sev === 'high' ? 3 : sev === 'medium' ? 2 : 1;
}

/** 解析裁决 JSON；解析不到返回 null（由调用方 default-deny） */
function parseVerdictJson(
  content: string,
): { verdict: ReviewVerdict; findings: ReviewFinding[]; suggestions: string[] } | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const { value, success } = safeJsonParse<{
    verdict?: string;
    result?: string;
    issues?: Array<{ severity?: string; category?: string; desc?: string; evidence?: string; recommendation?: string }>;
    suggestions?: string[];
  }>(match[0], {});
  if (!success || !value) return null;
  const raw = String(value.verdict || value.result || '').toLowerCase();
  const verdict: ReviewVerdict = (raw === 'pass' || raw === 'approved')
    ? 'pass'
    : (raw === 'reject' || raw === 'rejected') ? 'reject' : 'conditional';
  const findings: ReviewFinding[] = Array.isArray(value.issues)
    ? value.issues.slice(0, 8).map(i => {
        const sev = i?.severity === 'high' ? 'high' : i?.severity === 'low' ? 'low' : 'medium';
        const cat = i?.category;
        const category = cat === 'security' || cat === 'fact' || cat === 'logic' || cat === 'quality'
          ? cat : undefined;
        return {
          severity: sev,
          category,
          desc: String(i?.desc || '').slice(0, 200),
          evidence: typeof i?.evidence === 'string' ? i.evidence.slice(0, 300) : undefined,
          recommendation: typeof i?.recommendation === 'string' ? i.recommendation.slice(0, 300) : undefined,
        } as ReviewFinding;
      })
    : [];
  const suggestions = Array.isArray(value.suggestions) ? value.suggestions.slice(0, 5).map(String) : [];
  return { verdict, findings, suggestions };
}

function summarizeScores(opinions: string[]): number[] {
  return opinions
    .map(o => {
      const m = o.match(/(\d+(?:\.\d+)?)\s*[/／]\s*10/);
      return m ? Number(m[1]) : NaN;
    })
    .filter(n => Number.isFinite(n));
}

/** 分歧度：审查员打分的平均两两差值 / 10（0-1）；无打分返回 0.5（不确定 → 倾向加轮） */
function divergence(scores: number[]): number {
  if (scores.length < 2) return scores.length === 1 ? 0 : 0.5;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      sum += Math.abs(scores[i] - scores[j]);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0.5 : Math.min(1, sum / pairs / 10);
}

function buildReportText(
  targetLabel: string,
  policy: ReviewPolicy,
  gate: GateResult,
  sections: string[],
): string {
  const lines: string[] = ['【审查服务 · 最终报告】', ''];
  lines.push(`审查对象：${targetLabel}`);
  lines.push(`审查策略：${policy.id}（面板 ${policy.panel.length} 人 · ${policy.consensus.mode} 共识）`);
  lines.push(`裁决：${gate.verdict === 'pass' ? '✅ 通过' : gate.verdict === 'conditional' ? '⚠️ 有条件通过' : '❌ 驳回'}`);
  lines.push(`轮次：${gate.rounds}　降级：${gate.degraded ? '是（不得作为真实通过依据）' : '否'}`);
  if (gate.findings.length) {
    lines.push('');
    lines.push('## 存在的问题');
    gate.findings.forEach(f => lines.push(`- [${f.severity}] ${f.desc}`));
  }
  if (sections.length) {
    lines.push('');
    lines.push('## 审查记录');
    sections.forEach(s => lines.push(s));
  }
  return lines.join('\n');
}

export async function runReview(req: ReviewRequest): Promise<ReviewOutcome> {
  const policy = REVIEW_POLICIES[req.policyId] || REVIEW_POLICIES.standard;
  const auditIds: string[] = [];
  const routes: RouteDecision[] = [];

  // 演示模式：不调用模型，直接给出“有条件通过”的演示裁决。
  // 该裁决 degraded=true，永远不会被当作真实通过（live 门禁拒绝 demo 来源）。
  if (req.demo) {
    const gate: GateResult = {
      verdict: 'conditional',
      findings: [],
      degraded: true,
      rounds: 0,
      policyId: policy.id,
    };
    return {
      gate,
      reportText: `【审查服务 · 演示裁决】\n\n审查对象：${req.targetLabel}\n审查策略：${policy.id}\n裁决：⚠️ 有条件通过（演示模式，未调用模型；不计入真实通过）`,
      auditIds,
      routes,
    };
  }

  const sections: string[] = [];
  let degraded = false;
  let callSeq = 0;
  const call = async (agent: Agent | undefined, systemPrompt: string, userPrompt: string, label: string): Promise<string> => {
    if (!agent) {
      degraded = true;
      return '';
    }
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    callSeq += 1;
    agentRouter.begin(agent.id);
    try {
      const out = await invokeLLM({
        context: {
          taskId: req.context.taskId,
          nodeId: `${req.context.nodeId}:review:${label}:${callSeq}`,
          capability: 'review',
          attempt: 1,
        },
        agent,
        models: req.models,
        stage: 'review',
        systemPrompt,
        userPrompt,
        demo: req.demo,
        signal: req.signal,
        budget: req.budget,
        retry: { max: 1 },
      });
      auditIds.push(...out.auditIds);
      agentRouter.recordOutcome(agent.id, out.status === 'live', out.elapsedMs);
      if (out.status !== 'live') {
        degraded = true;
        return out.error ? `[调用失败] ${out.error.message}` : out.content;
      }
      return out.content;
    } finally {
      agentRouter.end(agent.id);
    }
  };

  // ---------- quick：单审查员一次调用 ----------
  if (policy.consensus.mode === 'single' || policy.panel.length === 1) {
    req.onProgress?.('quick', '单审查员快速审查');
    const reviewer = routeReviewer(req, policy.panel[0].role, routes);
    const content = await call(
      reviewer,
      REVIEWER_PROMPTS[policy.panel[0].promptKey],
      reviewerUserPrompt(req.targetLabel, req.targetContent, `审查策略：${policy.id}（单审）。`),
      'quick',
    );
    const parsed = parseReviewResult(content);
    const parsedSchema = parseVerdictJson(content);
    let verdict: ReviewVerdict = parsedSchema
      ? parsedSchema.verdict
      : parsed.approved ? 'pass' : 'reject';
    // 调用失败/降级时没有真实审查意见，只能给 conditional（由人工/真实模型复核），不能直接驳回
    if (degraded) verdict = 'conditional';
    const gate: GateResult = {
      verdict,
      findings: parsedSchema ? parsedSchema.findings : findingsFromIssues(parsed.issues),
      degraded,
      rounds: 1,
      policyId: policy.id,
    };
    sections.push(`- 单审（${reviewer?.name || '审核部'}）：${verdict === 'pass' ? '通过' : '未通过'}`);
    return { gate, reportText: buildReportText(req.targetLabel, policy, gate, sections), auditIds, routes };
  }

  // ---------- 准备层：正/反提取 ----------
  const extractor = routeReviewer(req, 'reviewer_logic', routes);
  let forward = '';
  let reverse = '';
  if (policy.preparation.forwardExtract) {
    req.onProgress?.('prep_extract', '正向信息提取');
    forward = await call(extractor, REVIEWER_PROMPTS.extractor, `请提取以下${req.targetLabel}的关键信息：\n\n${req.targetContent}`, 'extract');
  }
  if (policy.preparation.reverseExtract) {
    req.onProgress?.('prep_extract', '反向信息提取');
    reverse = await call(extractor, REVIEWER_PROMPTS.extractor2, `请从对立面补充以下${req.targetLabel}被忽视的维度：\n\n${req.targetContent}`, 'extract2');
  }
  if (forward) sections.push(`- 正向提取：${forward.slice(0, 400)}`);
  if (reverse) sections.push(`- 反向提取：${reverse.slice(0, 400)}`);

  // ---------- 轮次判定 ----------
  let totalRounds = policy.consensus.minRounds;
  if (policy.preparation.judgeRounds) {
    req.onProgress?.('prep_judge', '评估审查轮次');
    const judgeText = await call(
      routeReviewer(req, 'leader', routes),
      REVIEWER_PROMPTS.round_judge,
      `基于以下提取结果，判断该${req.targetLabel}需要几轮审查（只输出"需要 N 轮"）：\n\n${forward}\n${reverse}`,
      'judge',
    );
    const m = judgeText.match(/(\d+)\s*轮/);
    const judged = m ? parseInt(m[1], 10) : policy.consensus.maxRounds;
    totalRounds = Math.max(policy.consensus.minRounds, Math.min(policy.consensus.maxRounds, judged));
  }

  // ---------- 判定层：N 轮 × 面板审查员 ----------
  const roundOpinions: string[] = [];
  let currentRound = 0;
  let needNext = totalRounds > 1;
  while (currentRound < totalRounds && (needNext || currentRound < policy.consensus.minRounds)) {
    currentRound += 1;
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    req.onProgress?.('debate', `第 ${currentRound}/${totalRounds} 轮`);
    const prior = roundOpinions.length ? `\n\n前几轮意见摘要：\n${roundOpinions.slice(-3).join('\n')}` : '';
    const opinions = await Promise.all(
      policy.panel.map(async p => {
        const agent = routeReviewer(req, p.role, routes);
        const text = await call(
          agent,
          REVIEWER_PROMPTS[p.promptKey],
          reviewerUserPrompt(
            req.targetLabel,
            req.targetContent,
            `提取信息：\n${forward}\n${reverse}${prior}\n\n请独立给出意见并打分（格式："评分：X/10"）。`,
          ),
          `reviewer_${p.promptKey}`,
        );
        return { role: p.role, text };
      }),
    );
    roundOpinions.push(...opinions.map(o => `[${o.role}] ${o.text.slice(0, 600)}`));
    sections.push(`- 第 ${currentRound} 轮：${opinions.length} 名审查员完成`);

    const scores = summarizeScores(opinions.map(o => o.text));
    const div = divergence(scores);
    needNext = policy.consensus.mode === 'divergence'
      ? div >= policy.consensus.threshold
      : currentRound < policy.consensus.maxRounds;
    if (corruptScores(scores)) needNext = currentRound < totalRounds;
  }

  // ---------- 总结层：裁决 ----------
  req.onProgress?.('summary', '生成裁决报告');
  const judgeText = await call(
    routeReviewer(req, 'reviewer_logic', routes),
    REVIEWER_PROMPTS.final_judge,
    `请基于以下全部审查记录，对${req.targetLabel}给出最终裁决。\n\n待审内容：\n${req.targetContent}\n\n审查记录：\n${roundOpinions.join('\n\n')}\n\n【输出要求】最后输出 JSON：{"verdict":"pass"|"conditional"|"reject","issues":[{"severity":"high"|"medium"|"low","desc":"..."}],"suggestions":["..."]}`,
    'final_judge',
  );
  const parsedJudge = parseVerdictJson(judgeText);
  let verdict: ReviewVerdict;
  let findings: ReviewFinding[];
  if (parsedJudge) {
    verdict = parsedJudge.verdict;
    findings = parsedJudge.findings;
  } else {
    // default-deny：解析不到就按审查员意见取保守结论
    const approvals = roundOpinions.map(o => parseReviewResult(o));
    const rejected = approvals.some(a => !a.approved);
    verdict = degraded ? 'conditional' : rejected ? 'reject' : 'conditional';
    findings = findingsFromIssues(approvals.flatMap(a => a.issues));
  }
  // 高风险 finding 阻止“通过”
  if (verdict === 'pass' && severityRank(maxSeverity(findings)) >= severityRank(policy.verdict.blockOnSeverity)) {
    verdict = 'conditional';
  }
  // 降级：最高只能 conditional
  if (degraded && verdict === 'pass') verdict = 'conditional';
  // 轮次耗尽策略：reject 模式把“仍未通过”升级为明确驳回（pause 模式保持原裁决，由引擎暂停）
  if (verdict !== 'pass' && currentRound >= policy.consensus.maxRounds && policy.escalation.onRoundLimit === 'reject') {
    verdict = 'reject';
  }

  const gate: GateResult = {
    verdict,
    findings,
    degraded,
    rounds: currentRound,
    policyId: policy.id,
  };
  return { gate, reportText: buildReportText(req.targetLabel, policy, gate, sections), auditIds, routes };
}

/** 打分缺失过多时视为不确定（多跑一轮） */
function corruptScores(scores: number[]): boolean {
  return scores.length < 2;
}
