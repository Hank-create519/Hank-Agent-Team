// ============================================================
// 模拟响应库 —— 未配置 API Key 时的 fallback
// 按流水线阶段生成真实感强的中文 mock 产出，让流水线能完整验收
// ============================================================

import { PipelineStage } from './types';

// 将用户输入插入 mock，使其更有针对性
function snippet(input: string, max = 60): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean || '该任务';
}

export function mockResponse(stage: PipelineStage, userInput: string): string {
  const topic = snippet(userInput, 40);

  switch (stage) {
    case 'difficulty_assess':
      // 难度评估结果（由 difficultyRouter 单独处理，这里给个兜底）
      return JSON.stringify({
        difficulty: 'medium',
        reason: 'mock 默认中等',
        enableReviewFramework: true,
      });

    case 'init':
      return JSON.stringify({
        summary: `针对「${topic}」制定协作方案`,
        steps: ['extract', 'content_review', 'develop', 'code_review', 'deploy'],
        risks: [
          '信息来源不足可能导致提取偏差',
          '审核部可能多次打回，需控制重试次数',
          '部署环境依赖需提前确认',
        ],
        suggestedApproach: `分阶段推进：先由信息部提取关键信息，审核部把关内容准确性；再由开发部编码实现并自检，审核部审核代码质量；最后开发部执行部署。各部门通过通信总线直连协作，指挥部全程监听。`,
      }, null, 2);

    case 'audit_entry':
      // 方案级审查框架产出由 ReviewFramework 单独处理，这里给兜底
      return [
        '【审查框架 · 方案把关】',
        '',
        '裁决：✅ 通过',
        '',
        '评估：',
        `1. 需求「${topic}」目标清晰，方案可执行。`,
        '2. 已识别风险点，建议在对应阶段重点防范。',
      ].join('\n');

    case 'extract':
      return [
        '【信息部 · 提取结果】',
        '',
        '## 关键信息摘要',
        '',
        `1. 任务主题：${topic}`,
        '   - 来源：用户输入',
        '   - 类型：待开发需求',
        '',
        '2. 技术栈约束',
        '   - 前端：React 18 + TypeScript',
        '   - 桌面壳：Electron',
        '   - 来源：项目上下文',
        '',
        '3. 待补充项',
        '   - 具体功能细节（待用户进一步明确）',
        '   - 性能指标要求（待补充）',
      ].join('\n');

    case 'content_review':
      return [
        '【审核部 · 内容审核】',
        '',
        '判定：✅ 通过',
        '',
        '审核意见：',
        '- 信息来源标注完整，每条均有出处。',
        '- 待补充项已明确标注，未做主观臆断。',
        '- 信息摘要结构清晰，未发现事实性错误。',
      ].join('\n');

    case 'develop':
      return [
        '【开发部 · 编码实现】',
        '',
        '```typescript',
        '// 模块化实现示例',
        'export class TaskExecutor {',
        '  private status: "idle" | "running" | "done" = "idle";',
        '',
        '  async run(input: string): Promise<string> {',
        '    this.status = "running";',
        '    try {',
        '      const result = this.process(input);',
        '      this.status = "done";',
        '      return result;',
        '    } catch (e) {',
        '      this.status = "idle";',
        '      throw e;',
        '    }',
        '  }',
        '',
        '  private process(input: string): string {',
        '    return `已处理: ${input}`;',
        '  }',
        '}',
        '```',
        '',
        '【队长自检】',
        '- ✅ 语法检查通过',
        '- ✅ 边界条件已处理',
        '- ✅ 无明显性能问题',
      ].join('\n');

    case 'code_review':
      return [
        '【审核部 · 代码审核】',
        '',
        '判定：✅ 通过',
        '',
        '审核项：',
        '- 语法正确性：通过',
        '- 安全漏洞：未发现',
        '- 性能问题：无',
        '- 边界条件：已覆盖',
      ].join('\n');

    case 'deep_audit':
      // 系统级深度审计由 ReviewFramework 单独处理，这里给兜底
      return [
        '【审查框架 · 系统级深度审计】',
        '',
        '裁决：✅ 通过',
        '',
        '系统级兜底审计完成，未发现致命问题。',
      ].join('\n');

    case 'deploy':
      return [
        '【开发部 · 部署执行】',
        '',
        '$ vite build',
        '✓ 构建 dist/ 完成',
        '',
        '$ asar pack dist → app.asar',
        '✓ 打包完成',
        '',
        '✓ 部署成功',
      ].join('\n');

    case 'done':
      return [
        '【指挥部 · 任务汇总】',
        '',
        `## 任务交付报告`,
        '',
        `**需求**：${topic}`,
        '',
        '## 执行概览',
        '',
        '| 阶段 | 负责部门 | 结果 |',
        '|------|----------|------|',
        '| 难度评估 | 指挥部 | ✅ |',
        '| 制定方案 | 指挥部 | ✅ |',
        '| 审查把关 | 审核部(审查框架) | ✅ |',
        '| 信息提取 | 信息部 | ✅ |',
        '| 内容审核 | 审核部 | ✅ |',
        '| 编码实现 | 开发部 | ✅ |',
        '| 代码审核 | 审核部 | ✅ |',
        '| 部署上线 | 开发部 | ✅ |',
        '',
        '## 交付结论',
        '',
        '流水线全部阶段顺利完成。产出物已就绪，任务交付完成。',
      ].join('\n');

    default:
      return `[模拟产出] 阶段 ${stage} 完成`;
  }
}

// 一句话摘要，用于时间线卡片
export function mockSummary(stage: PipelineStage): string {
  const map: Record<PipelineStage, string> = {
    difficulty_assess: '难度评估完成',
    init: '方案已制定，识别 3 项风险',
    audit_entry: '审查框架把关完成',
    extract: '提取 3 条关键信息，2 项待补充',
    content_review: '内容审核通过，无事实性错误',
    develop: '编码完成，队长自检通过',
    code_review: '代码审核通过，未发现漏洞',
    deep_audit: '系统级深度审计完成',
    deploy: '部署成功，重试 0 次',
    done: '全部阶段完成，任务交付',
  };
  return map[stage] ?? '完成';
}

// 模拟审核打回（用于触发"打回>3次暂停"机制的演示场景，默认不打回）
export function mockReject(): boolean {
  return false;
}

// ============================================================
// 难度评估 mock（无 API Key 时）
// ============================================================

export function mockDifficultyAssessment(userInput: string) {
  const complex = /系统设计|架构|多模块|集成|复杂代码|重要报告|全面分析|深度/i;
  const simple = /^(你好|hello|hi|谢谢|再见|帮助|help)$/i;
  if (complex.test(userInput)) {
    return { difficulty: 'complex' as const, reason: 'mock：检测到复杂关键词', estimatedRounds: 3, enableReviewFramework: true };
  }
  if (simple.test(userInput.trim()) || userInput.trim().length < 10) {
    return { difficulty: 'simple' as const, reason: 'mock：简单任务', estimatedRounds: 0, enableReviewFramework: false };
  }
  return { difficulty: 'medium' as const, reason: 'mock：中等任务（默认）', estimatedRounds: 1, enableReviewFramework: true };
}

// ============================================================
// 审查框架 mock 数据（无 API Key 时让三层流程可完整验收）
// ============================================================

export const mockReviewFramework = {
  systemPrompt: `【审查框架 · 模拟产出】

由于未配置 API Key，以下为审查框架的模拟执行结果，用于验证三层流程完整性。`,

  extractor: `## 核心要素
- 关键实体：任务主体、需求项
- 隐含假设：方案可执行、资源充足
- 利益相关方：用户、开发团队
- 时间约束：未提及

## 可攻击的假设
1. 假设需求不会变更
2. 假设技术栈稳定

## 缺失数据
1. 性能指标要求
2. 验收标准`,

  extractor2: `## 被忽视的维度
| 主提取器假设 | 质疑方向 |
|------------|---------|
| 需求不变 | 用户需求可能频繁迭代 |
| 资源充足 | 并发场景下资源可能不足 |

## 利益受损方
1. 维护人员（技术债）

## 替代方案
1. 采用更轻量的实现路径`,

  roundJudge: `经评估，需要3轮辩论。

判定理由：该任务涉及多维度交叉，需要从逻辑、事实、用户三个视角深入审查。`,

  reviewer_logic: `## 逻辑漏洞
1. 因果链不完整（严重程度：中）
2. 边界条件未覆盖（严重程度：高）

## 逻辑强度分：7/10
## 核心问题
- 边界条件处理不足
- 异常路径缺失`,

  reviewer_fact: `## 事实核查结果
1. 技术选型声明 → 准确
2. 性能假设 → 存疑（未提供基准数据）

## 准确性分：8/10
## 核心问题
- 缺少性能基准数据支撑`,

  reviewer_user: `## 用户体验评估
1. 交互流程：清晰（影响程度：低）
2. 错误提示：不够友好（影响程度：中）

## 用户体验分：7/10
## 核心问题
- 错误场景的用户引导不足`,

  integration: `## 攻击点统计
| 审查员 | 攻击点 | 有效 | 无效 | 致命 |
|--------|--------|------|------|------|
| 逻辑派 | 2 | 2 | 0 | 1 |
| 事实派 | 2 | 1 | 1 | 0 |
| 用户派 | 2 | 2 | 0 | 0 |

## 致命一击：边界条件未覆盖
## 盲区：未考虑并发场景
## 需要下一轮：否（有效攻击4个，分歧度低）`,

  finalJudge: `## 裁决摘要
方案整体可行，但存在边界条件和错误处理方面的不足。建议有条件通过，待补充相关处理后交付。

## 最终结论：有条件通过`,
};

// 一句话摘要表更新（新增阶段）
export const mockSummaryExtended: Record<string, string> = {
  difficulty_assess: '难度评估完成',
  init: '方案已制定，识别 3 项风险',
  audit_entry: '审查框架把关完成',
  extract: '提取 3 条关键信息，2 项待补充',
  content_review: '内容审核通过',
  develop: '编码完成，队长自检通过',
  code_review: '代码审核通过',
  deep_audit: '系统级深度审计完成',
  deploy: '部署成功',
  done: '任务交付完成',
};
