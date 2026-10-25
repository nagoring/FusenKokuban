const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE_FILTERS = [{ name: '付箋黒板ファイル', extensions: ['fusen', 'json'] }];
let lastFilePath = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '付箋黒板',
    backgroundColor: '#2f5d3a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ---- 保存・読み込み ----
ipcMain.handle('board:save', async (e, json) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'ボードを保存',
    defaultPath: lastFilePath || path.join(app.getPath('documents'), '付箋黒板.fusen'),
    filters: FILE_FILTERS,
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.promises.writeFile(filePath, json, 'utf8');
  lastFilePath = filePath;
  return { canceled: false, filePath };
});

ipcMain.handle('board:load', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'ボードを読み込み',
    defaultPath: lastFilePath || app.getPath('documents'),
    filters: FILE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };
  const json = await fs.promises.readFile(filePaths[0], 'utf8');
  lastFilePath = filePaths[0];
  return { canceled: false, filePath: filePaths[0], json };
});

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
