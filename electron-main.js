const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// ==================== V2.2 基础设施（主进程独占） ====================
const secrets = require('./electron/secrets.cjs');
const audit = require('./electron/audit.cjs');
const gateway = require('./electron/llm-gateway.cjs');

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  secrets.init({ userDataPath, safeStorage: require('electron').safeStorage });
  audit.init({ userDataPath });

  // macOS 原生应用菜单（role 菜单保留系统原生行为：Cmd+Q 退出、编辑/视图/窗口等）
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ])
    );
  }
});

function createWindow() {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0a0a0c',
    // macOS：使用系统原生红绿灯按钮 + hiddenInset 隐藏标题栏 + 毛玻璃质感；
    // Windows/Linux：无边框窗口，由渲染层绘制自定义标题栏控制按钮。
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', vibrancy: 'dark' }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发模式加载 Vite Dev Server；生产（打包）模式加载 dist/index.html
  // app.isPackaged 为 true 时表示运行于 electron-builder 打包后的安装包内
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // 同步窗口最大化状态给渲染进程（仅 Windows/Linux 自定义标题栏按钮需要；
  // macOS 使用系统红绿灯按钮，无需此事件）
  if (!isMac) {
    win.on('maximize', () => win.webContents.send('window-maximized-change', true));
    win.on('unmaximize', () => win.webContents.send('window-maximized-change', false));
  }

  // 安全边界：禁止渲染进程打开新窗口或导航到未知目标（防注入后外跳）
  // 白名单用 URL 解析后精确匹配协议/主机/端口，避免 startsWith 前缀绕过：
  //   生产：仅允许应用自身打包资源（file:）
  //   开发：额外允许 Vite Dev Server（http://localhost:5173 精确匹配）
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try {
      const u = new URL(url);
      if (app.isPackaged) {
        // 仅允许应用自身打包资源（file: + 精确的 index.html 路径）
        const selfPath = path.join(__dirname, 'dist', 'index.html').split(path.sep).join('/');
        const navPath = decodeURIComponent(u.pathname).replace(/^\//, '');
        allowed = u.protocol === 'file:' && navPath === selfPath.replace(/^\//, '');
      } else {
        allowed = (u.protocol === 'http:' && u.hostname === 'localhost' && u.port === '5173');
      }
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });

  return win;
}

// ==================== 窗口控制 IPC（注册一次） ====================
// macOS 使用系统红绿灯按钮（原生标题栏），不需要自定义最小化/最大化/关闭逻辑，
// 因此该 IPC 与最大化状态查询仅在 Windows/Linux 平台注册。
if (process.platform !== 'darwin') {
  ipcMain.on('window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (action === 'minimize') {
      win.minimize();
    } else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') {
      win.close();
    }
  });

  ipcMain.handle('window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });
}

// ==================== 受限 exec（仅允许 git 只读命令，供 GitPanel 使用） ====================
// ==================== V2.2 IPC：Secrets / LLM Gateway / Workspaces ====================
// 密钥：渲染层只能 set/delete/list（agentId 列表），永远拿不到内容
ipcMain.handle('secrets-set', (event, agentId, plain) => {
  requireMainWindow(event);
  return secrets.setSecret(String(agentId), String(plain));
});
ipcMain.handle('secrets-delete', (event, agentId) => {
  requireMainWindow(event);
  return secrets.deleteSecret(String(agentId));
});
ipcMain.handle('secrets-list', (event) => {
  requireMainWindow(event);
  return secrets.listSecrets();
});
// 只回答"该 Agent 有没有 Key"，不返回内容
ipcMain.handle('secrets-has', (event, agentId) => {
  requireMainWindow(event);
  return secrets.hasSecret(String(agentId));
});

// LLM Gateway：渲染层传业务参数（agentId/provider/model/prompt），密钥解析与 HTTP 全在主进程
ipcMain.handle('llm-call', (event, payload) => {
  requireMainWindow(event);
  return gateway.callLLM(payload || {});
});
ipcMain.handle('llm-test', (event, payload) => {
  requireMainWindow(event);
  return gateway.testConnection(payload || {});
});
// 真实取消：按 taskId 中止主进程在途请求（Renderer stop 时调用）
ipcMain.handle('llm-cancel', (event, taskId) => {
  requireMainWindow(event);
  return gateway.cancelTask(String(taskId || ''));
});



function requireMainWindow(event) {
  const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === event.sender.id);
  if (!win) throw new Error('非法来源');
}

// ==================== 阶段产出持久化（原子写入 userData） ====================
// 仅接受主窗口渲染进程的请求；写临时文件后 rename 覆盖，避免写入中断导致损坏。
ipcMain.handle('persist-save', async (event, action, payload) => {
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.id === event.sender.id);
  if (!win) throw new Error('非法来源');
  if (typeof action !== 'string' || action.length > 64) throw new Error('非法 action');

  const file = path.join(app.getPath('userData'), 'pipeline-state.json');
  const tmp = file + '.tmp';
  let data = {};
  try { data = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { data = {}; }
  data[action] = payload;
  data.savedAt = new Date().toISOString();
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fsp.rename(tmp, file);
  return true;
});

// ==================== 生命周期 ====================
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Windows / Linux 下关闭所有窗口即退出；macOS 保留 dock 进程
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
