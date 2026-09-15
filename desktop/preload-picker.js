const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
    onSources: (callback) => ipcRenderer.on('sources', (event, sources) => callback(sources)),
    select: (id) => ipcRenderer.send('source-selected', id),
    cancel: () => ipcRenderer.send('source-selected', null)
});
