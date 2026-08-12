import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openOAuth: (url: string) => ipcRenderer.invoke('open-oauth', url),
  getStoreValue: (key: string) => ipcRenderer.invoke('store:get', key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  deleteStoreValue: (key: string) => ipcRenderer.invoke('store:delete', key),
  onPythonStatus: (cb: (status: string) => void) =>
    ipcRenderer.on('python-status', (_e, status) => cb(status)),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
})
