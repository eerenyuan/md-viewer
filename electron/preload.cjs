const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('viewer', {
  onTabsChanged: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tabs-changed', listener)
    return () => ipcRenderer.removeListener('tabs-changed', listener)
  },
  onContentUpdated: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('content-updated', listener)
    return () => ipcRenderer.removeListener('content-updated', listener)
  },
  getState: () => ipcRenderer.invoke('get-state'),
  getTabContent: (path) => ipcRenderer.invoke('get-tab-content', path),
  activateTab: (path) => ipcRenderer.invoke('activate-tab', path),
  closeTab: (path) => ipcRenderer.invoke('close-tab', path),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setThemeSource: (source) => ipcRenderer.invoke('set-theme-source', source),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  resolveEmbed: (baseDir, ref) => ipcRenderer.invoke('resolve-embed', baseDir, ref),
  readEmbed: (filePath) => ipcRenderer.invoke('read-embed', filePath),
  exportPdf: (opts) => ipcRenderer.invoke('export-pdf', opts),
})
