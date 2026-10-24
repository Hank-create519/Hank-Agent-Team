// ============================================================
// V2.2 基础设施回归测试：Chat Intent Router / Tool Runtime 策略 / 审计
// ============================================================
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyIntent } from '../chatRouter';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const toolRuntime = require_('../../../electron/tool-runtime.cjs');
const audit = require_('../../../electron/audit.cjs');

describe('chatRouter.classifyIntent（意图分类）', () => {
  it('进度查询', () => {
    expect(classifyIntent('现在任务到哪了？')).toEqual({ type: 'progress' });
    expect(classifyIntent('运行状态怎么样')).toEqual({ type: 'progress' });
  });

  it('控制指令：暂停/继续/停止', () => {
    expect(classifyIntent('暂停')).toEqual({ type: 'control', action: 'pause' });
    expect(classifyIntent('继续')).toEqual({ type: 'control', action: 'resume' });
    expect(classifyIntent('停止')).toEqual({ type: 'control', action: 'stop' });
  });

  it('部门提问 → dept 意图', () => {
    const r = classifyIntent('问开发部：这次改动会影响哪些模块？');
    expect(r).toEqual({ type: 'dept', dept: 'develop' });
  });

  it('普通需求 → new-task', () => {
    expect(classifyIntent('分析一下这个产品的市场')).toEqual({ type: 'new-task' });
  });
});

describe('toolRuntime.checkPolicy（部门授权）', () => {
  it('信息部允许 web_search', () => {
    expect(toolRuntime.checkPolicy('info', 'web_search')).toBeNull();
  });

  it('指挥部无任何工具权限', () => {
    expect(toolRuntime.checkPolicy('command', 'web_search')).toMatch(/无权使用/);
  });

  it('未启用工具被拒绝（read_file V2.5 接入）', () => {
    expect(toolRuntime.checkPolicy('develop', 'read_file')).toMatch(/尚未启用/);
  });

  it('未知工具被拒绝', () => {
    expect(toolRuntime.checkPolicy('info', 'hack_tool')).toMatch(/未知工具/);
  });
});

describe('toolRuntime.executeTool（参数校验 + 审计）', () => {
  it('web_search 缺少 query → 参数校验拒绝', async () => {
    const r = await toolRuntime.executeTool({ dept: 'info', sessionId: 't1', toolName: 'web_search', args: {} });
    expect(r.ok).toBe(false);
    expect(r.content).toContain('参数校验');
  });

  it('query 超长 → 拒绝', async () => {
    const r = await toolRuntime.executeTool({
      dept: 'info', sessionId: 't1', toolName: 'web_search',
      args: { query: 'x'.repeat(301) },
    });
    expect(r.ok).toBe(false);
    expect(r.content).toContain('长度');
  });

  it('审计日志记录拒绝事件', async () => {
    audit.init({ userDataPath: join(tmpdir(), 'hank-audit-test-' + Date.now()) });
    await toolRuntime.executeTool({ dept: 'command', sessionId: 't2', toolName: 'web_search', args: { query: 'x' } });
    const tail = audit.tail(5);
    expect(tail.some((e: any) => e.type === 'tool-denied')).toBe(true);
  });
});
