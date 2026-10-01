const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');

function createWindow() {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#05050F',
    frame: false,
    // macOS 专属：隐藏标题栏并保留红绿灯按钮 + 毛玻璃质感
    ...(isMac ? { titleBarStyle: 'hiddenInset', vibrancy: 'dark' } : {}),
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

  // 同步窗口最大化状态给渲染进程（用于 Windows 自定义标题栏按钮图标切换）
  win.on('maximize', () => win.webContents.send('window-maximized-change', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized-change', false));

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

// ==================== 受限 exec（仅允许 git 只读命令，供 GitPanel 使用） ====================
// 使用 execFile 而非 exec：不经过 shell，参数逐项传递，避免命令注入。
// 仅接受数组格式 ['git', ...args]；子命令限定只读白名单，
// 拒绝 reset/clean/push/commit 等可改变仓库状态或外联的子命令。
const GIT_READONLY_SUBCOMMANDS = new Set([
  'diff', 'status', 'log', 'show', 'ls-files', 'rev-parse', 'branch', 'remote', 'grep', 'shortlog',
]);

ipcMain.handle('exec', async (event, command) => {
  if (!Array.isArray(command) || command.length === 0 || command[0] !== 'git') {
    throw new Error('仅允许执行 git 命令（数组格式）');
  }
  if (command.length > 20) {
    throw new Error('参数数量超出限制');
  }
  // 识别子命令（跳过全局选项，如 -C <path>、--git-dir=...）
  let subcommand = '';
  for (let i = 1; i < command.length; i++) {
    const a = String(command[i]);
    if (a.startsWith('-')) continue;
    subcommand = a;
    break;
  }
  if (!GIT_READONLY_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`仅允许只读 git 子命令（${[...GIT_READONLY_SUBCOMMANDS].join(', ')}），拒绝「${subcommand || '(空)'}」`);
  }
  const args = command.slice(1).map((arg) => {
    const str = String(arg);
    if (str.length > 500) throw new Error('单个参数长度超出限制');
    return str;
  });
  return new Promise((resolve) => {
    execFile('git', args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // git diff 在无差异时以非零码退出，但仍需返回 stdout
      resolve({ stdout: stdout || '', stderr: stderr || '', code: error ? error.code : 0 });
    });
  });
});

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
