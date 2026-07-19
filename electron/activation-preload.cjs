// Preload for the activation window — exposes exactly one call to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licensing', {
  activate: (key) => ipcRenderer.invoke('license:activate', key)
});
