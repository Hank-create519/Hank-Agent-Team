// 部门间直连通信通道
// 指挥部只监听，不中转阻塞

import { Department, Task } from './types';

export interface Message {
  id: string;
  from: Department;
  to: Department;
  type: 'task' | 'result' | 'review' | 'error' | 'ack';
  taskId: string;
  payload: string;
  timestamp: string;
}

type MessageHandler = (msg: Message) => void;

class CommunicationBus {
  private handlers = new Map<Department, MessageHandler[]>();
  private history: Message[] = [];

  // 注册监听（指挥部通过此入口监听所有部门间通信）
  subscribe(department: Department, handler: MessageHandler) {
    if (!this.handlers.has(department)) {
      this.handlers.set(department, []);
    }
    this.handlers.get(department)!.push(handler);
  }

  // 部门间直连发送，同时抄送指挥部
  send(from: Department, to: Department, type: Message['type'], taskId: string, payload: string) {
    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      type,
      taskId,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.history.push(msg);

    // 发送给目标部门
    const targets = this.handlers.get(to) || [];
    targets.forEach(h => h(msg));

    // 抄送指挥部（指挥部是 'command' 部门）
    if (from !== 'command') {
      const cmdHandlers = this.handlers.get('command') || [];
      cmdHandlers.forEach(h => h(msg));
    }
  }

  // 获取历史
  getHistory(limit = 50): Message[] {
    return this.history.slice(-limit);
  }
}

// 全局单例
export const bus = new CommunicationBus();
