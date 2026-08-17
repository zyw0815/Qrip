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
let authWin = null;
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
    if (electron_1.app.isPackaged) {
        // Packaged: spawn the PyInstaller-built standalone backend binary.
        // onedir layout: resources/backend/qrip-server/qrip-server(.exe)
        const binaryName = process.platform === 'win32' ? 'qrip-server.exe' : 'qrip-server';
        pythonProcess = (0, child_process_1.spawn)(path_1.default.join(process.resourcesPath, 'backend', 'qrip-server', binaryName), [], { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    }
    else {
        // Dev: use the conda env python directly.
        pythonProcess = (0, child_process_1.spawn)('/opt/anaconda3/envs/music/bin/python3', [path_1.default.join(__dirname, '..', 'python', 'server.py')], { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    }
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
    mainWindow.on('closed', () => {
        mainWindow = null;
        // Closing the main window quits the app, even if the OAuth window is
        // still open (window-all-closed wouldn't fire while it exists).
        if (authWin && !authWin.isDestroyed())
            authWin.close();
        electron_1.app.quit();
    });
}
// IPC Handlers
electron_1.ipcMain.handle('open-oauth', async (_e, url) => {
    return new Promise((resolve) => {
        // Fresh in-memory partition every time — no cookies, no remembered
        // Google account. The user always starts from a clean login page.
        const partition = `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        authWin = new electron_1.BrowserWindow({
            width: 1200,
            height: 800,
            title: 'Qrip — Google Login',
            webPreferences: {
                partition,
            },
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
            // Drop the session's in-memory data so nothing lingers.
            authWin.webContents.session.clearStorageData();
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
electron_1.ipcMain.handle('open-external', async (_e, url) => {
    // Only allow http/https links — anything else is refused.
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
        return;
    await electron_1.shell.openExternal(url);
});
electron_1.ipcMain.handle('app-version', () => electron_1.app.getVersion());
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
