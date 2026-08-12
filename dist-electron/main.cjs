"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const electron_store_1 = __importDefault(require("electron-store"));
const store = new electron_store_1.default({ name: 'qrip-config' });
let mainWindow = null;
let pythonProcess = null;
function startPython() {
    const pythonPath = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'python', 'venv', 'bin', 'python3')
        : '/opt/anaconda3/envs/music/bin/python3';
    const scriptPath = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'python', 'server.py')
        : path_1.default.join(__dirname, '..', 'python', 'server.py');
    pythonProcess = (0, child_process_1.spawn)(pythonPath, [scriptPath], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    pythonProcess.stdout?.on('data', (data) => {
        const msg = data.toString();
        console.log(`[py] ${msg}`);
        if (msg.includes('Uvicorn running')) {
            mainWindow?.webContents.send('python-status', 'ready');
        }
    });
    pythonProcess.stderr?.on('data', (data) => {
        console.error(`[py:err] ${data}`);
        mainWindow?.webContents.send('python-status', data.toString());
    });
    pythonProcess.on('close', (code) => {
        console.log(`[py] process exited with code ${code}`);
    });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 960,
        height: 680,
        minWidth: 720,
        minHeight: 520,
        backgroundColor: '#08080f',
        titleBarStyle: 'hiddenInset',
        title: 'Qrip',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '..', 'dist', 'index.html'));
    }
    mainWindow.on('closed', () => { mainWindow = null; });
}
// IPC Handlers
electron_1.ipcMain.handle('open-oauth', async (_e, url) => {
    return new Promise((resolve) => {
        const authWin = new electron_1.BrowserWindow({
            width: 800,
            height: 700,
            title: 'Qrip — Google Login',
        });
        authWin.loadURL(url);
        const handleNavigation = (navUrl) => {
            try {
                const parsed = new URL(navUrl);
                if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                    const token = parsed.searchParams.get('token');
                    if (token) {
                        authWin.removeAllListeners();
                        authWin.close();
                        resolve(token);
                    }
                }
            }
            catch {
                // not a valid URL, ignore
            }
        };
        authWin.webContents.on('will-redirect', (_ev, navUrl) => handleNavigation(navUrl));
        authWin.webContents.on('will-navigate', (_ev, navUrl) => handleNavigation(navUrl));
        authWin.on('closed', () => {
            authWin.removeAllListeners();
            resolve(null);
        });
    });
});
electron_1.ipcMain.handle('store:get', (_e, key) => store.get(key));
electron_1.ipcMain.handle('store:set', (_e, key, value) => {
    store.set(key, value);
    return true;
});
electron_1.ipcMain.handle('store:delete', (_e, key) => {
    store.delete(key);
    return true;
});
electron_1.ipcMain.handle('get-download-path', () => electron_1.app.getPath('music'));
electron_1.ipcMain.handle('dialog:pick-folder', async () => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select download folder',
        defaultPath: electron_1.app.getPath('music'),
    });
    return result.canceled ? null : result.filePaths[0];
});
electron_1.app.whenReady().then(() => {
    startPython();
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    pythonProcess?.kill();
    electron_1.app.quit();
});
electron_1.app.on('before-quit', () => {
    pythonProcess?.kill();
});
