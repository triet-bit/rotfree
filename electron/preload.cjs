const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  saveImage: (bytes, ext) => ipcRenderer.invoke('img:save', bytes, ext),
  setMode: (mode) => ipcRenderer.invoke('win:setMode', mode),
  toggleOnTop: () => ipcRenderer.invoke('win:toggleOnTop'),
  setFocus: (on) => ipcRenderer.invoke('win:setFocus', on),
  setLaunchAtLogin: (on) => ipcRenderer.invoke('app:setLaunchAtLogin', on),
  notify: (title, body) => ipcRenderer.send('app:notify', title, body),
  show: () => ipcRenderer.send('win:show'),
  hide: () => ipcRenderer.send('win:hide'),
  minimize: () => ipcRenderer.send('win:minimize'),
  openExternal: (url) => ipcRenderer.send('app:openExternal', url),
  onOnTop: (cb) => ipcRenderer.on('win:onTop', (_e, on) => cb(on)),
  onFlush: (cb) => ipcRenderer.on('app:flush', async () => {
    await cb();
    ipcRenderer.send('app:flushed');
  }),
});
