const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 当前平台：'darwin' | 'win32' | 'linux'
  platform: process.platform,

  // 窗口控制（Windows 自定义标题栏按钮调用）
  windowControl: (action) => ipcRenderer.send('window-control', action),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback) =>
    ipcRenderer.on('window-maximized-change', (_event, value) => callback(value)),

  // 阶段产出持久化（主进程原子写入 userData/pipeline-state.json）
  persistSave: (action, payload) => ipcRenderer.invoke('persist-save', action, payload),

  // ===== V2.2 基础设施 =====
  // Secrets：渲染层只 set/delete/list agentId，永远拿不到密钥内容
  secretsSet: (agentId, plain) => ipcRenderer.invoke('secrets-set', agentId, plain),
  secretsDelete: (agentId) => ipcRenderer.invoke('secrets-delete', agentId),
  secretsList: () => ipcRenderer.invoke('secrets-list'),
  secretsHas: (agentId) => ipcRenderer.invoke('secrets-has', agentId),
  // LLM Gateway：密钥解析与 provider 调用全在主进程
  llmCall: (payload) => ipcRenderer.invoke('llm-call', payload),
  llmTest: (payload) => ipcRenderer.invoke('llm-test', payload),
  // 真实取消：Renderer 停止任务时中止主进程在途模型请求
  llmCancel: (taskId) => ipcRenderer.invoke('llm-cancel', taskId),
});
