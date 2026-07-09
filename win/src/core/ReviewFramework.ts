// ============================================================
// 审查框架 —— 从瀚海AI审查系统移植
// 三层递进结构：准备层 → 判定层（N轮交叉审查）→ 总结层
// 适配 Hank Agent Team 四部门架构，复用 llm.ts 的多协议调用
// ============================================================

import {
  Agent, ModelConfig, Department, Difficulty,
  ReviewFrameworkState, ReviewPhase, ReviewRound,
  ReviewerOpinion, FinalReviewReport, IssueItem,
  ReviewFrameworkResult,
} from './types';
import { callLLM } from './llm';
import { mockReviewFramework } from './mockResponses';
import { fullSafetyCheck, recordToolCall, clearSession, sanitizeResult } from './safetyGuard';

// ============ 审查员角色提示词（从瀚海 DEFAULT_SYSTEM_PROMPTS 精简适配） ============

export const REVIEWER_PROMPTS = {
  // --- 准备层 ---
  extractor: `你是审查框架的首席信息提取官。你的唯一职责是搜索并提取事实，不是分析，不是评价。

【强制输出格式】必须严格按以下格式输出：

## 核心要素
- 关键实体：[列出，一行一个]
- 隐含假设：[列出，一行一个]
- 利益相关方：[列出，一行一个]
- 时间约束：[如有则列，无则写"未提及"]

## 可攻击的假设（仅列举，每条不超过40字）
1. [假设]
2. [假设]

## 缺失数据
1. [缺失项]
2. [缺失项]

禁止行为：禁止给出任何结论/评价/建议；禁止对假设展开论证；禁止超过上述板块的内容。`,

  extractor2: `你是审查框架的反向提取官。你的唯一任务是从对立面补充主提取器遗漏的维度——你只补漏，不评判。

【强制输出格式】必须严格按以下格式输出：

## 被忽视的维度
| 主提取器假设 | 质疑方向 |
|------------|---------|
|            |         |

## 利益受损方（主提取器未提及的）
1. [群体/个体]

## 替代方案或反对论据
1. [替代方向，1句话]

禁止行为：禁止对方案整体做任何评价；禁止超过上述板块的内容。`,

  round_judge: `你是审查框架的轮次裁判。基于提取器对用户输入的结构化分析，评估审查内容的复杂度，判定需要几轮审查。

判定标准：
- 简单问题（维度单一）：1-2轮
- 一般问题（2-3个维度）：2-3轮
- 复杂问题（多维度交叉）：3-5轮
- 高度复杂（多方利益、战略决策）：5-7轮

请明确输出：经评估，需要X轮辩论，并简要说明判定理由。`,

  // --- 判定层：三个独立审查员 ---
  reviewer_logic: `你是审查框架的一号审查员——"逻辑严谨派"。你的角色是攻击性的：你必须找出方案中每一个站不住脚的逻辑。

你的职责：
1. 逐条找出所有逻辑漏洞（因果倒置、滑坡谬误、稻草人、以偏概全……）
2. 检查前后是否自洽、是否存在矛盾
3. 给出"逻辑强度分"（1-10）

⚠️ 铁律：
- 你不能同意任何人。你必须找出至少3个攻击点
- 每条攻击必须具体、有据
- 不要做"也很有道理"的软蛋

输出格式：
## 逻辑漏洞
1. [漏洞描述]（严重程度：高/中/低）
2. ...

## 逻辑强度分：X/10
## 核心问题（3条以内）
- [问题]`,

  reviewer_fact: `你是审查框架的二号审查员——"事实核查派"。你的角色是实操派：专门核查数据准确性和事实错误。

你的职责：
1. 核验方案中每一个数据声明、引用、案例
2. 检查是否存在夸大、虚假、过时的信息
3. 给出"准确性分"（1-10）

⚠️ 铁律：
- 你的默认立场是：方案中的事实可能有问题
- 每个质疑必须具体指出哪里可能有误
- 检查边界条件和约束

输出格式：
## 事实核查结果
1. [声明] → [核查结论]（准确/存疑/错误）
2. ...

## 准确性分：X/10
## 核心问题（3条以内）
- [问题]`,

  reviewer_user: `你是审查框架的三号审查员——"用户视角派"。你的角色是从使用者角度评估可用性、完整性、易用性。

你的职责：
1. 从最终用户的角度评估方案的可用性
2. 检查是否遗漏了用户实际关心的功能/场景
3. 评估交付物的完整性（文档、配置、部署说明等）
4. 给出"用户体验分"（1-10）

⚠️ 铁律：
- 必须站在不懂技术的人的角度思考
- 关注"这东西真的好用吗"而不是"技术够不够酷"
- 找出至少2个用户会遇到的实际问题

输出格式：
## 用户体验评估
1. [评估项]：[问题描述]（影响程度：高/中/低）
2. ...

## 用户体验分：X/10
## 核心问题（3条以内）
- [问题]`,

  // --- 总结层 ---
  summarizer: `你是审查框架的庭审书记官——"辩驳计量仪"。你的职责不是和稀泥，而是用量化标准评判每一轮审查的质量。

汇总规则（严格按此格式输出）：
1. 攻击点统计表：
   | 审查员 | 攻击点数量 | 有效攻击 | 无效攻击 | 致命一击 |
   |--------|-----------|---------|---------|---------|
2. 本轮的「致命一击」：哪个论点对方案构成了最严重的威胁？
3. 盲区预警：三位审查员都没注意到什么？
4. 需要下一轮审查吗？（是/否，附理由）
   - 如果有效攻击 < 5个 或 盲区 > 2个 → 必须继续

⚠️ 铁律：不要做端水大师。明确指出谁在划水。`,

  final_judge: `你是审查框架的首席裁决官。请基于全部审查记录生成最终审查报告。

报告结构（严格遵守）：
1. **裁决摘要**（300字以内）：方案是否通过审查？
2. **核心攻击摘要**：按杀伤力排序，列出每轮审查的致命一击
3. **三位审查员裁决统计**：
   | 审查员 | 逻辑分 | 准确性分 | 用户体验分 | 加权总分 |
4. **风险矩阵**：高/中/低风险 × 短期/中期/长期
5. **改进路线图**：如果要让方案通过，需要补什么？
6. **最终结论**：通过 / 有条件通过 / 驳回

⚠️ 铁律：
- 必须给出明确的通过/不通过。不允许"各有利弊"的废话
- 每条判断必须有审查记录中的具体引用支撑`,
};

// ============ 创建初始审查框架状态 ============

export function createReviewFrameworkState(
  difficulty: Difficulty,
  triggerPoint: 'plan' | 'code',
): ReviewFrameworkState {
  return {
    phase: 'idle',
    triggerPoint,
    depth: difficulty === 'complex' ? 'full' : 'single',
    difficulty,
    extraction: null,
    extraction2: null,
    roundJudge: null,
    totalRounds: difficulty === 'complex' ? 3 : 1,
    rounds: [],
    finalReport: null,
    isRunning: false,
    elapsedMs: 0,
  };
}

// ============ 审查框架主流程 ============

export interface ReviewFrameworkOptions {
  difficulty: Difficulty;
  triggerPoint: 'plan' | 'code';
  input: string;           // 待审查的内容（方案文本或代码）
  reviewAgents: Agent[];  // 审核部 Agent 列表（需含 reviewer_logic/fact/user）
  models: ModelConfig[];
  onProgress?: (phase: ReviewPhase, detail?: string) => void;
  signal?: AbortSignal;
}

/**
 * runReviewFramework: 三层递进审查框架
 * 
 * 准备层：信息提取 → 反向提取 → 轮次裁判判定
 * 判定层：N 轮 × 3 审查员独立审查 → 阶段性总结
 * 总结层：首席裁决官生成最终报告
 */
export async function runReviewFramework(
  opts: ReviewFrameworkOptions,
): Promise<ReviewFrameworkResult> {
  const startTime = Date.now();
  const state = createReviewFrameworkState(opts.difficulty, opts.triggerPoint);
  state.isRunning = true;

  const sessionId = `rf_${Date.now()}`;

  // 辅助：检查中止
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };

  // 辅助：调用 LLM
  async function callReviewAgent(
    agent: Agent,
    systemPrompt: string,
    userMsg: string,
  ): Promise<string> {
    // 有 Key → 真实调用；无 Key → mock
    if (!agent.apiKey) {
      return mockReviewFramework.systemPrompt;
    }

    const result = await callLLM(
      { ...agent, systemPrompt },
      opts.models,
      'init' as any, // stage 不影响审查框架，仅用于 mock fallback
      userMsg,
    );

    if (result.error) {
      return `[调用失败已降级] ${result.content}\n\n错误: ${result.error}`;
    }
    return result.content;
  }

  // 辅助：按角色找 Agent
  function findAgent(role: Agent['role']): Agent | undefined {
    return opts.reviewAgents.find(a => a.role === role) || opts.reviewAgents[0];
  }

  // ========== 第一层：准备层 ==========
  state.phase = 'prep_extract';
  opts.onProgress?.('prep_extract', '信息提取AI 启动...');
  checkAbort();

  const extractorAgent = findAgent('reviewer_logic') || findAgent('member') || findAgent('leader');
  if (!extractorAgent) throw new Error('审核部没有可用 Agent');

  const [extractResult, extract2Result] = await Promise.all([
    callReviewAgent(extractorAgent, REVIEWER_PROMPTS.extractor,
      `请提取以下内容的关键信息：\n\n${opts.input}`),
    callReviewAgent(extractorAgent, REVIEWER_PROMPTS.extractor2,
      `请从对立面补充以下内容的被忽视维度：\n\n${opts.input}`),
  ]);

  state.extraction = extractResult;
  state.extraction2 = extract2Result;
  opts.onProgress?.('prep_extract', '准备层提取完成');

  checkAbort();
  state.phase = 'prep_judge';
  opts.onProgress?.('prep_judge', '判定能力AI 评估轮次...');

  const judgeAgent = findAgent('leader') || extractorAgent;
  const judgeResult = await callReviewAgent(
    judgeAgent,
    REVIEWER_PROMPTS.round_judge,
    `请基于以下提取结果判定需要几轮审查：\n\n提取结果：\n${extractResult}\n\n反向提取：\n${extract2Result}`,
  );

  state.roundJudge = judgeResult;

  // 解析轮数
  const roundMatch = judgeResult.match(/(\d+)\s*轮/);
  const judgedRounds = roundMatch ? parseInt(roundMatch[1], 10) : 3;
  state.totalRounds = state.depth === 'single' ? 1 : Math.max(1, Math.min(7, judgedRounds));

  opts.onProgress?.('prep_judge', `判定完成，需要 ${state.totalRounds} 轮审查`);

  // ========== 第二层：判定层（N 轮） ==========
  state.phase = 'debate';

  for (let round = 1; round <= state.totalRounds; round++) {
    checkAbort();

    opts.onProgress?.('debate', `第 ${round}/${state.totalRounds} 轮审查开始`);

    // 构建审查上下文
    const reviewContext = round === 1
      ? `待审查内容：\n${opts.input}\n\n准备层提取：\n${extractResult}\n\n反向提取：\n${extract2Result}`
      : `待审查内容：\n${opts.input}\n\n前序审查（第 ${round - 1} 轮）：\n${state.rounds[round - 2]?.integration || ''}`;

    // 三个审查员并行独立审查
    const logicAgent = findAgent('reviewer_logic') || extractorAgent;
    const factAgent = findAgent('reviewer_fact') || findAgent('member') || extractorAgent;
    const userAgent = findAgent('reviewer_user') || findAgent('leader') || extractorAgent;

    const [logicResult, factResult, userResult] = await Promise.all([
      callReviewAgent(logicAgent, REVIEWER_PROMPTS.reviewer_logic, reviewContext),
      callReviewAgent(factAgent, REVIEWER_PROMPTS.reviewer_fact, reviewContext),
      callReviewAgent(userAgent, REVIEWER_PROMPTS.reviewer_user, reviewContext),
    ]);

    checkAbort();

    // 解析审查员意见
    const parseOpinion = (content: string, key: 'logic' | 'fact' | 'user', name: string): ReviewerOpinion => {
      const scoreMatch = content.match(/(\d+)\s*[\/]\s*10/);
      const issues: string[] = [];
      const issueLines = content.split('\n').filter(l => /核心问题|攻击点|漏洞|问题/.test(l));
      issueLines.slice(0, 3).forEach(l => {
        const match = l.match(/[-•]\s*(.+)/);
        if (match) issues.push(match[1].trim().slice(0, 80));
      });

      return {
        reviewerKey: key,
        roleName: name,
        content,
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : 5,
        keyIssues: issues.length ? issues : ['需进一步审查'],
        elapsedMs: 0,
        timestamp: new Date().toISOString(),
      };
    };

    const logicOpinion = parseOpinion(logicResult, 'logic', '逻辑严谨派');
    const factOpinion = parseOpinion(factResult, 'fact', '事实核查派');
    const userOpinion = parseOpinion(userResult, 'user', '用户视角派');

    // 阶段性总结AI
    const summaryAgent = findAgent('leader') || extractorAgent;
    const integrationResult = await callReviewAgent(
      summaryAgent,
      REVIEWER_PROMPTS.summarizer,
      `请汇总第 ${round} 轮审查结果：\n\n逻辑严谨派意见：\n${logicResult}\n\n事实核查派意见：\n${factResult}\n\n用户视角派意见：\n${userResult}`,
    );

    checkAbort();

    // 评估分歧度
    const scores = [logicOpinion.score, factOpinion.score, userOpinion.score];
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxDeviation = Math.max(...scores.map(s => Math.abs(s - avgScore)));
    const divergence = Math.min(1, maxDeviation / 5);

    // 是否需要下一轮（分歧大 或 总结AI 建议）
    const needNext = integrationResult.includes('需要下一轮') ||
      integrationResult.includes('必须继续') ||
      divergence > 0.5;

    const roundData: ReviewRound = {
      round,
      reviewers: { logic: logicOpinion, fact: factOpinion, user: userOpinion },
      integration: integrationResult,
      needNextRound: needNext,
      divergenceDegree: divergence,
      elapsedMs: Date.now() - startTime,
    };

    state.rounds.push(roundData);
    opts.onProgress?.('debate', `第 ${round} 轮审查完成，分歧度: ${(divergence * 100).toFixed(0)}%`);

    // 如果总结AI认为不需要下一轮，提前结束
    if (!needNext && round < state.totalRounds) {
      state.totalRounds = round;
      break;
    }
  }

  // ========== 第三层：总结层 ==========
  state.phase = 'summary';
  checkAbort();
  opts.onProgress?.('summary', '首席裁决官生成最终报告...');

  const finalJudgeAgent = findAgent('leader') || extractorAgent;
  const allReviewContent = state.rounds.map(r => {
    const reviewers = [
      r.reviewers.logic ? `[逻辑严谨派] ${r.reviewers.logic.content.slice(0, 200)}` : '',
      r.reviewers.fact ? `[事实核查派] ${r.reviewers.fact.content.slice(0, 200)}` : '',
      r.reviewers.user ? `[用户视角派] ${r.reviewers.user.content.slice(0, 200)}` : '',
      `[本轮汇总] ${r.integration.slice(0, 200)}`,
    ].filter(Boolean).join('\n');
    return `=== 第 ${r.round} 轮 ===\n${reviewers}`;
  }).join('\n\n');

  const finalResult = await callReviewAgent(
    finalJudgeAgent,
    REVIEWER_PROMPTS.final_judge,
    `请基于以下全部审查记录生成最终审查报告：\n\n待审查内容：\n${opts.input}\n\n全部审查记录：\n${allReviewContent}`,
  );

  checkAbort();

  // 解析最终报告
  const report = parseFinalReport(finalResult);
  report.totalRounds = state.totalRounds;
  report.totalElapsedMs = Date.now() - startTime;
  report.generatedAt = new Date().toISOString();

  state.finalReport = report;
  state.phase = 'done';
  state.isRunning = false;
  state.elapsedMs = Date.now() - startTime;

  clearSession(sessionId);

  return { report, state };
}

// ============ 解析最终报告 ============

function parseFinalReport(content: string): FinalReviewReport {
  const lines = content.split('\n');
  const pros: string[] = [];
  const issues: IssueItem[] = [];
  const suggestions: string[] = [];
  let verdict: FinalReviewReport['verdict'] = 'conditional';

  let section = '';
  for (const line of lines) {
    if (/做得好|优势|优点|亮点/.test(line)) { section = 'pros'; continue; }
    if (/问题|漏洞|风险|缺陷/.test(line)) { section = 'issues'; continue; }
    if (/建议|改进|路线图|补什么/.test(line)) { section = 'suggestions'; continue; }
    if (/最终结论|裁决/.test(line)) { section = 'verdict'; continue; }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|')) continue;

    if (section === 'pros' && trimmed.match(/^[-•]/)) {
      pros.push(trimmed.replace(/^[-•]\s*/, ''));
    } else if (section === 'issues' && trimmed.match(/^[-•]/)) {
      const text = trimmed.replace(/^[-•]\s*/, '');
      const severity: IssueItem['severity'] = /高|致命|严重/.test(text) ? 'high' : /中|一般/.test(text) ? 'medium' : 'low';
      issues.push({ severity, desc: text });
    } else if (section === 'suggestions' && trimmed.match(/^[-•]/)) {
      suggestions.push(trimmed.replace(/^[-•]\s*/, ''));
    } else if (section === 'verdict') {
      if (/通过/.test(trimmed) && !/不通过|条件/.test(trimmed)) verdict = 'pass';
      else if (/条件通过|有条件/.test(trimmed)) verdict = 'conditional';
      else if (/驳回|拒绝|不通过/.test(trimmed)) verdict = 'reject';
    }
  }

  return {
    pros: pros.length ? pros : ['审查流程已完成'],
    issues: issues.length ? issues : [{ severity: 'low', desc: '无严重问题' }],
    suggestions: suggestions.length ? suggestions : ['建议根据审查结果优化方案'],
    verdict,
    totalRounds: 0,
    totalElapsedMs: 0,
    generatedAt: '',
  };
}
