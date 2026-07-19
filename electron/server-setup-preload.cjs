// Preload for the first-launch server setup window — exposes exactly the two calls it needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('serverConfig', {
  test: (url) => ipcRenderer.invoke('server-config:test', url),
  save: (config) => ipcRenderer.invoke('server-config:save', config)
});
