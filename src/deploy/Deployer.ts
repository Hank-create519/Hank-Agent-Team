// 部署模块
// 负责：执行部署脚本 → 失败自动重试 → 汇报结果

import { LogEntry } from '../core/types';

export interface DeployConfig {
  command: string;       // 部署命令
  cwd?: string;          // 工作目录
  maxRetries: number;    // 最大重试次数 (默认 1)
  timeout: number;       // 超时时间 ms
}

export interface DeployResult {
  success: boolean;
  log: string;
  retries: number;
  error?: string;
}

const DEFAULT_CONFIG: Partial<DeployConfig> = {
  maxRetries: 1,
  timeout: 60000,
};

// 执行部署
export async function deploy(config: DeployConfig): Promise<DeployResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError = '';

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      // 此处对接实际部署后端
      // 在 Hank Agent Team 中，部署由开发部通过 shell_executor 或 computer-agent 执行
      const result = await executeDeploy(finalConfig.command, finalConfig.cwd, finalConfig.timeout);

      if (result.success) {
        return {
          success: true,
          log: result.output,
          retries: attempt,
        };
      }

      lastError = result.error || '未知错误';
    } catch (e: any) {
      lastError = e.message || '部署异常';
    }
  }

  return {
    success: false,
    log: '',
    retries: finalConfig.maxRetries,
    error: lastError,
  };
}

// 部署执行器桩（实际由开发部 Agent 调用系统工具）
async function executeDeploy(
  command: string,
  cwd?: string,
  timeout?: number
): Promise<{ success: boolean; output: string; error?: string }> {
  // 桩实现 —— 实际运行时由开发部 Agent 接管
  // 开发部小队长会调用 shell_executor 执行部署命令
  console.log(`[Deployer] 执行: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`);

  return {
    success: true,
    output: `[模拟] 命令 "${command}" 执行成功`,
  };
}

// 生成部署失败报告
export function generateDeployReport(
  taskId: string,
  result: DeployResult
): string {
  if (result.success) {
    return [
      `## 部署成功`,
      `- 任务: ${taskId}`,
      `- 重试次数: ${result.retries}`,
      `\n\`\`\`\n${result.log}\n\`\`\``,
    ].join('\n');
  }

  return [
    `## 部署失败报告`,
    `- 任务: ${taskId}`,
    `- 已重试: ${result.retries} 次`,
    `- 错误: ${result.error}`,
    `\n当前状态: 已暂停，等待你的指令`,
    `\n可选操作: 手动修复 / 切换模型 / 跳过部署`,
  ].join('\n');
}
