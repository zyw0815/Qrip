"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openOAuth: (url) => electron_1.ipcRenderer.invoke('open-oauth', url),
    getStoreValue: (key) => electron_1.ipcRenderer.invoke('store:get', key),
    setStoreValue: (key, value) => electron_1.ipcRenderer.invoke('store:set', key, value),
    deleteStoreValue: (key) => electron_1.ipcRenderer.invoke('store:delete', key),
    onPythonStatus: (cb) => electron_1.ipcRenderer.on('python-status', (_e, status) => cb(status)),
    getDownloadPath: () => electron_1.ipcRenderer.invoke('get-download-path'),
    pickFolder: () => electron_1.ipcRenderer.invoke('dialog:pick-folder'),
    openExternal: (url) => electron_1.ipcRenderer.invoke('open-external', url),
});
