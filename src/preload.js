const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poolAPI', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  setZoomFactor: (factor) => ipcRenderer.invoke('ui:setZoom', factor),
  exportState: (state) => ipcRenderer.invoke('state:export', state),
  exportSettlementCsv: (csv) => ipcRenderer.invoke('settlement:exportCsv', csv)
});
