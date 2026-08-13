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
// Qobuz sends X-User-Auth-Token header on authenticated API requests.
// Intercept it during the OAuth window's session to capture credentials.
function interceptQobuzAuth(session, onCaptured) {
    session.webRequest.onBeforeSendHeaders({ urls: ['*://*.qobuz.com/*', '*://play.qobuz.com/*'] }, (details, callback) => {
        const authToken = details.requestHeaders['X-User-Auth-Token'];
        if (authToken && typeof authToken === 'string' && authToken.length > 10) {
            onCaptured(authToken);
        }
        callback({ requestHeaders: details.requestHeaders });
    });
}
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
            preload: path_1.default.join(__dirname, 'preload.cjs'),
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
            width: 1200,
            height: 800,
            title: 'Qrip — Google Login',
        });
        authWin.loadURL(url);
        let resolved = false;
        let pollInterval = null;
        let capturedToken = '';
        const finish = (token) => {
            if (resolved)
                return;
            resolved = true;
            if (pollInterval)
                clearInterval(pollInterval);
            authWin.webContents.session.webRequest.onBeforeSendHeaders(null);
            authWin.removeAllListeners();
            if (!authWin.isDestroyed())
                authWin.close();
            resolve(token);
        };
        // Capture X-User-Auth-Token from any authenticated Qobuz API call.
        // This is the reliable way — the web player sends it on every
        // request after login.
        interceptQobuzAuth(authWin.webContents.session, (token) => {
            if (resolved)
                return;
            console.log(`[oauth] captured X-User-Auth-Token (${token.length} chars)`);
            capturedToken = token;
        });
        // Poll every 2s — once we have a captured token, pair it with
        // the user id from localStorage and finish.
        pollInterval = setInterval(async () => {
            if (resolved || !capturedToken)
                return;
            try {
                let userId = '';
                const localUser = await authWin.webContents.executeJavaScript(`localStorage.getItem('localuser') || ''`);
                try {
                    const parsed = JSON.parse(localUser);
                    if (parsed.id)
                        userId = String(parsed.id);
                    else {
                        const m = localUser.match(/"id":(\d+)/);
                        if (m)
                            userId = m[1];
                    }
                }
                catch { /* ignore */ }
                console.log(`[oauth] poll: token=YES, userId=${userId || 'no'}`);
                if (userId)
                    finish(JSON.stringify({ token: capturedToken, userId }));
            }
            catch (err) {
                console.log(`[oauth] poll error: ${err}`);
            }
        }, 2000);
        authWin.on('closed', () => finish(null));
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
