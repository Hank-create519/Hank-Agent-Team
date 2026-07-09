const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

// ==================== 受限 exec（仅允许 git 命令，供 GitPanel 使用） ====================
// 使用 execFile 而非 exec：不经过 shell，参数逐项传递，避免命令注入。
ipcMain.handle('exec', async (event, command) => {
  const parts = String(command || '').trim().split(/\s+/);
  if (parts.length === 0 || parts[0] !== 'git') {
    throw new Error('仅允许执行 git 命令');
  }
  const args = parts.slice(1);
  return new Promise((resolve) => {
    execFile('git', args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // git diff 在无差异时以非零码退出，但仍需返回 stdout
      resolve({ stdout: stdout || '', stderr: stderr || '', code: error ? error.code : 0 });
    });
  });
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
