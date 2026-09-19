// Minimal, explicit bridge between the local setup/offline HTML pages and
// the main process. Nothing here is exposed to pages loaded from your
// actual Bizness-Ph-OS server — this preload only runs for this app's own
// local setup/offline screens (see main.js), since those are the only
// pages that call window.desktop.*.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setServerUrl: (url) => ipcRenderer.send('desktop:set-server-url', url),
  retry: () => ipcRenderer.send('desktop:retry'),
});
