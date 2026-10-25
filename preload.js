const { contextBridge, ipcRenderer } = require('electron');

// 画面（renderer）から使うファイル保存・読み込みの窓口
contextBridge.exposeInMainWorld('fusen', {
  saveBoard: (json) => ipcRenderer.invoke('board:save', json),
  loadBoard: () => ipcRenderer.invoke('board:load'),
});
