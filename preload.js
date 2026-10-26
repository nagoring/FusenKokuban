const { contextBridge, ipcRenderer } = require('electron');

// 画面（renderer）から使うファイル保存・読み込みの窓口
contextBridge.exposeInMainWorld('fusen', {
  saveBoard: (json) => ipcRenderer.invoke('board:save', json),
  loadBoard: () => ipcRenderer.invoke('board:load'),
  captureBoard: () => ipcRenderer.invoke('board:capture'),
  exportImage: (png, name) => ipcRenderer.invoke('board:export-image', png, name),
  // 自動保存（画像を含むと localStorage の容量を超えるため、ユーザーデータのファイルに保存する）
  readState: () => ipcRenderer.sendSync('state:read'),
  writeState: (json) => ipcRenderer.invoke('state:write', json),
  writeStateSync: (json) => ipcRenderer.sendSync('state:write-sync', json),
});
