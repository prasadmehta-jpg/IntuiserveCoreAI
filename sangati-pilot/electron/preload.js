const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sangati', {
  getLocalIP:   () => ipcRenderer.invoke('get-local-ip'),
  getPorts:     () => ipcRenderer.invoke('get-ports'),
  getVersion:   () => ipcRenderer.invoke('get-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openLogs:     () => ipcRenderer.invoke('open-logs'),
  scanCameras:  () => ipcRenderer.invoke('scan-cameras'),
  checkVision:  () => ipcRenderer.invoke('check-vision'),
  isElectron:   true,
});
