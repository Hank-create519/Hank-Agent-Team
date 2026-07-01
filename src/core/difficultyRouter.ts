// ============================================================
// 难度路由 —— 指挥部评估任务复杂度并分流
// 对齐提示词：简单档直出 / 中等单轮审查 / 复杂多轮审查
// ============================================================

import { Agent, ModelConfig, Difficulty, DifficultyAssessment } from './types';
import { callLLM } from './llm';

// 难度评估系统提示词
const DIFFICULTY_PROMPT = `你是 Hank Agent Team 指挥部的难度评估官。你的唯一任务是判断用户需求的复杂度档位。

判定标准：
- 简单档（simple）：常规问答、简单文案、小问题、信息查询、格式转换、小修改
- 中等档（medium）：普通报告、一般方案、常规代码、中等复杂度的分析任务
- 复杂档（complex）：重要报告、复杂代码、系统设计、逻辑严密的方案、多模块集成

你必须严格按以下格式输出（不要输出任何其他内容）：

档位：simple / medium / complex
理由：[一句话说明判定依据]`;

// 快速关键词预判（避免简单任务也调用 LLM）
function quickAssess(input: string): Difficulty | null {
  const simple = /^(你好|hello|hi|谢谢|再见|帮助|help)$/i;
  if (simple.test(input.trim())) return 'simple';

  // 超短输入倾向于简单
  if (input.trim().length < 10) return 'simple';

  // 不确定则交由 LLM 判定
  return null;
}

/**
 * assessDifficulty: 评估任务难度
 * 
 * 先快速预判，简单任务直接返回；否则调用指挥部 Agent 的 LLM 进行判定。
 */
export async function assessDifficulty(
  userInput: string,
  commandAgent: Agent,
  models: ModelConfig[],
  signal?: AbortSignal,
): Promise<DifficultyAssessment> {
  // 快速预判
  const quick = quickAssess(userInput);
  if (quick) {
    return {
      difficulty: quick,
      reason: quick === 'simple' ? '简单任务（快速预判）' : '',
      estimatedRounds: 0,
      enableReviewFramework: false,
    };
  }

  // 无 API Key 时使用基于关键词的中等判定
  if (!commandAgent.apiKey) {
    return keywordAssessment(userInput);
  }

  // 调用 LLM 判定
  try {
    const result = await callLLM(
      { ...commandAgent, systemPrompt: DIFFICULTY_PROMPT },
      models,
      'difficulty_assess' as any,
      `请评估以下需求的复杂度：\n\n${userInput}`,
    );

    const content = result.content;

    // 解析档位
    let difficulty: Difficulty = 'medium';
    if (/simple/i.test(content)) difficulty = 'simple';
    else if (/complex/i.test(content)) difficulty = 'complex';

    // 解析理由
    const reasonMatch = content.match(/理由[：:]\s*(.+)/);
    const reason = reasonMatch ? reasonMatch[1].trim() : 'LLM 判定';

    const enableReview = difficulty !== 'simple';
    const estimatedRounds = difficulty === 'complex' ? 3 : difficulty === 'medium' ? 1 : 0;

    return { difficulty, reason, estimatedRounds, enableReviewFramework: enableReview };
  } catch {
    // LLM 调用失败 → 关键词兜底
    return keywordAssessment(userInput);
  }
}

// 基于关键词的兜底评估
function keywordAssessment(input: string): DifficultyAssessment {
  const complex = /系统设计|架构|多模块|集成|复杂代码|重要报告|全面分析|深度/i;
  const simple = /简单|快速|小|格式|转换|修改一个|改一下|查一下/i;

  if (complex.test(input)) {
    return {
      difficulty: 'complex',
      reason: '关键词匹配（复杂档）',
      estimatedRounds: 3,
      enableReviewFramework: true,
    };
  }
  if (simple.test(input)) {
    return {
      difficulty: 'simple',
      reason: '关键词匹配（简单档）',
      estimatedRounds: 0,
      enableReviewFramework: false,
    };
  }
  return {
    difficulty: 'medium',
    reason: '关键词匹配（中等档，默认）',
    estimatedRounds: 1,
    enableReviewFramework: true,
  };
}
