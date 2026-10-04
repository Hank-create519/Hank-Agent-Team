const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#05050F',
    vibrancy: 'dark',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(() => {
      const win = new BrowserWindow({
        width: 1400, height: 900, frame: false,
        titleBarStyle: 'hiddenInset', backgroundColor: '#05050F',
        vibrancy: 'dark',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true, nodeIntegration: false,
        },
      });
      win.loadFile(path.join(__dirname, 'index.html'));
    });
  }
});
