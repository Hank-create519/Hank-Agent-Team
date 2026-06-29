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
      return [
        '【审查系统 · 入口把关】',
        '',
        '判定：✅ 通过',
        '',
        '评估：',
        `1. 需求「${topic}」目标清晰，可拆解为可执行任务。`,
        '2. 方案步骤合理，符合四部门协作流程。',
        '3. 已识别风险点 3 项，建议在对应阶段重点防范。',
        '',
        '建议：',
        '- 信息提取阶段标注每条信息的来源',
        '- 代码审核重点关注安全漏洞与边界条件',
        '- 部署前确认环境就绪，失败保留一次重试',
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
        '',
        '改进建议（非阻塞）：',
        '- 可补充技术选型的对比依据',
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
        `      const result = this.process(input);`,
        '      this.status = "done";',
        '      return result;',
        '    } catch (e) {',
        '      this.status = "idle";',
        '      throw e;',
        '    }',
        '  }',
        '',
        '  private process(input: string): string {',
        '    // 核心处理逻辑',
        '    return `已处理: ${input}`;',
        '  }',
        '}',
        '```',
        '',
        '【队长自检】',
        '- ✅ 语法检查通过',
        '- ✅ 边界条件已处理（空输入、异常）',
        '- ✅ 状态机完整，无遗漏分支',
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
        '- 安全漏洞：未发现 SQL 注入、XSS 等风险',
        '- 性能问题：无 O(n²) 循环，资源释放及时',
        '- 边界条件：空输入与异常路径已覆盖',
        '',
        '改进建议（非阻塞）：',
        '- 可考虑增加单元测试覆盖',
        '- process 方法可进一步拆分以提升可读性',
      ].join('\n');

    case 'deploy':
      return [
        '【开发部 · 部署执行】',
        '',
        '$ vite build',
        '✓ 构建 dist/ 完成',
        '',
        '$ asar pack dist → app.asar',
        '✓ 打包完成 (173KB)',
        '',
        '$ 替换 Hank Agent Team.app/Contents/Resources/app.asar',
        '✓ 部署成功',
        '',
        '部署报告：',
        '- 构建产物：dist/（前端 + electron 主进程）',
        '- 打包结果：app.asar',
        '- 部署位置：桌面 Hank Agent Team.app',
        '- 重试次数：0',
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
        '| 制定方案 | 指挥部 | ✅ |',
        '| 审查把关 | 审核部 | ✅ 通过 |',
        '| 信息提取 | 信息部 | ✅ |',
        '| 内容审核 | 审核部 | ✅ 通过 |',
        '| 编码实现 | 开发部 | ✅ |',
        '| 代码审核 | 审核部 | ✅ 通过 |',
        '| 部署上线 | 开发部 | ✅ |',
        '',
        '## 交付结论',
        '',
        '流水线 8 阶段全部顺利完成，审核打回 0 次，部署重试 0 次。',
        '产出物已就绪，任务交付完成。',
      ].join('\n');

    default:
      return `[模拟产出] 阶段 ${stage} 完成`;
  }
}

// 一句话摘要，用于时间线卡片
export function mockSummary(stage: PipelineStage): string {
  const map: Record<PipelineStage, string> = {
    init: '方案已制定，识别 3 项风险',
    audit_entry: '入口把关通过',
    extract: '提取 3 条关键信息，2 项待补充',
    content_review: '内容审核通过，无事实性错误',
    develop: '编码完成，队长自检通过',
    code_review: '代码审核通过，未发现漏洞',
    deploy: '部署成功，重试 0 次',
    done: '8 阶段全部完成，任务交付',
  };
  return map[stage] ?? '完成';
}

// 模拟审核打回（用于触发"打回>3次暂停"机制的演示场景，默认不打回）
export function mockReject(): boolean {
  return false;
}
