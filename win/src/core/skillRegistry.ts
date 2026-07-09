// ============================================================
// Skill Registry (P1-3) — 本地技能注册表
// 为 Agent.skills 标签提供语义定义，供 Engine.runStage 注入 system prompt
// ============================================================

import { SkillDefinition } from './types';

const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    id: 'code_review',
    name: '代码审查',
    description: '对代码进行安全漏洞、性能瓶颈、逻辑错误和代码风格的全面审查',
    systemPromptSnippet: `[技能·代码审查]
你需要对代码进行系统性审查，重点关注：
1. 安全漏洞（SQL 注入、XSS、硬编码凭据）
2. 性能瓶颈（不必要的循环、内存泄漏、N+1 查询）
3. 逻辑错误（边界条件、空指针、并发安全）
4. 代码风格（命名规范、模块划分、注释质量）
输出格式：按严重程度（P0/P1/P2）分类列出问题，每条附具体代码位置和建议修改方案。`,
  },
  {
    id: 'info_retrieval',
    name: '信息检索',
    description: '从大量文本中高效提取关键信息，标注来源与可信度',
    systemPromptSnippet: `[技能·信息检索]
你需要从给定材料中提取关键信息，遵循以下规范：
1. 每条信息标注出处（文档段落/章节）
2. 评估信息可信度（高/中/低），附评估理由
3. 区分事实与推断，推断类信息明确标注
4. 优先提取与任务目标相关的结构化数据（数字、日期、名称、关系）
输出格式：使用"来源: xxx | 可信度: 高/中/低"标注每条信息。`,
  },
  {
    id: 'doc_generation',
    name: '文档生成',
    description: '生成结构清晰、格式规范的技术文档、API 文档、用户手册',
    systemPromptSnippet: `[技能·文档生成]
你需要生成高质量技术文档，遵循以下规范：
1. 使用 Markdown 格式，标题层级合理（H1→H2→H3）
2. 代码示例完整可运行，标注语言类型
3. API 文档使用标准模板：端点、方法、参数表、请求/响应示例、错误码
4. 关键概念加粗，生僻术语附简要解释
5. 末尾附版本信息和更新日期`,
  },
  {
    id: 'data_cleaning',
    name: '数据清洗',
    description: '对结构化数据进行去重、格式化、缺失值处理和异常检测',
    systemPromptSnippet: `[技能·数据清洗]
你需要对数据进行清洗和预处理：
1. 检测并报告缺失值位置和比例
2. 识别异常值和格式不一致（日期、数字、编码）
3. 去重：按业务主键或全字段匹配判定重复
4. 标准化：统一日期格式、数值精度、字符串编码
5. 输出清洗报告（处理前后行数、各列处理方式、丢弃数据原因）`,
  },
  {
    id: 'logic_review',
    name: '逻辑审查',
    description: '对业务逻辑、决策流程和推理链进行严谨性审查',
    systemPromptSnippet: `[技能·逻辑审查]
你需要对给定的逻辑/推理链进行严谨审查：
1. 检查前提假设是否成立（明确列出并逐一验证）
2. 识别逻辑谬误（循环论证、因果倒置、以偏概全）
3. 验证推理链的每一步是否自洽
4. 发现隐含前提并评估其合理性
5. 对不确定的结论标注置信度
输出格式：按"前提 → 推理 → 结论"三段式分析，每步标注通过/存疑/谬误。`,
  },
  {
    id: 'architecture_design',
    name: '架构设计',
    description: '进行系统架构设计，包括模块划分、接口定义、数据流和技术选型',
    systemPromptSnippet: `[技能·架构设计]
你需要进行系统架构设计，覆盖以下维度：
1. 模块划分：高内聚低耦合，明确各模块职责边界
2. 接口定义：模块间通信协议、数据格式、错误处理约定
3. 数据流：从输入到输出的完整数据生命周期
4. 技术选型：列出候选方案及选型理由（性能/生态/团队能力）
5. 非功能需求：可扩展性、容错、监控、安全策略
输出格式：架构图（ASCII art）+ 关键决策记录（ADR）+ 风险清单。`,
  },
];

const registry = new Map<string, SkillDefinition>();
BUILTIN_SKILLS.forEach(s => registry.set(s.id, s));

/** 根据 id 获取 Skill 定义 */
export function getSkill(id: string): SkillDefinition | undefined {
  return registry.get(id);
}

/** 列出全部已注册的 Skill */
export function listSkills(): SkillDefinition[] {
  return Array.from(registry.values());
}

/** 按 id 列表批量获取 Skill 定义 */
export function getSkills(ids: string[]): SkillDefinition[] {
  return ids.map(id => registry.get(id)).filter(Boolean) as SkillDefinition[];
}

export { registry as skillRegistry };
