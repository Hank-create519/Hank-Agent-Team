const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 当前平台：'darwin' | 'win32' | 'linux'
  platform: process.platform,

  // 窗口控制（Windows 自定义标题栏按钮调用）
  windowControl: (action) => ipcRenderer.send('window-control', action),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback) =>
    ipcRenderer.on('window-maximized-change', (_event, value) => callback(value)),

  // 受限命令执行（仅 git，由主进程安全校验），返回 { stdout, stderr, code }
  exec: (command) => ipcRenderer.invoke('exec', command),
});
