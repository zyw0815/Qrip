"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_store_1 = __importDefault(require("electron-store"));
const store = new electron_store_1.default({ name: 'qrip-config' });
const hasInstanceLock = electron_1.app.requestSingleInstanceLock();
let mainWindow = null;
let authWin = null;
let pythonProcess = null;
let quitting = false;
let backendRestarts = 0;
let restartTimer = null;
// All backend output goes here so users can send it for diagnostics —
// the Electron console is invisible in packaged builds.
function backendLogPath() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'backend.log');
}
let backendLog = null;
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
    if (quitting || pythonProcess)
        return;
    // Roll the log when it grows past 1MB — it's for diagnostics, not history.
    if (!backendLog) {
        try {
            if (fs_1.default.existsSync(backendLogPath()) && fs_1.default.statSync(backendLogPath()).size > 1024 * 1024) {
                fs_1.default.writeFileSync(backendLogPath(), '[log rolled]\n');
            }
        }
        catch {
            // userData unreadable — logging will just fail silently below
        }
        backendLog = fs_1.default.createWriteStream(backendLogPath(), { flags: 'a' });
        // A diagnostic log failure must not crash the desktop app (#84).
        backendLog.on('error', (err) => console.error('Backend log unavailable:', err.message));
    }
    backendLog.write(`\n=== Qrip ${electron_1.app.getVersion()} (${process.platform} ${process.arch}) starting backend ===\n`);
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
    const child = pythonProcess;
    let spawnFailed = false;
    let portConflict = false;
    let ready = false;
    const checkReady = (msg) => {
        if (!ready && msg.includes('Uvicorn running')) {
            ready = true;
            mainWindow?.webContents.send('python-status', 'ready');
            if (backendRestarts > 0) {
                void electron_1.dialog.showMessageBox({
                    type: 'warning', title: 'Qrip — backend restarted',
                    message: 'The backend was restarted. Please re-add any unfinished downloads.\n后端已恢复，未完成的下载请重新加入队列。',
                }).catch(console.error);
            }
        }
    };
    child.stdout?.on('data', (data) => {
        const msg = data.toString();
        console.log(`[py] ${msg}`);
        backendLog?.write(`[out] ${msg}`);
        checkReady(msg);
    });
    child.stderr?.on('data', (data) => {
        const msg = data.toString();
        console.error(`[py:err] ${msg}`);
        backendLog?.write(`[err] ${msg}`);
        if (/address already in use|EADDRINUSE|10048|Errno (48|98)/i.test(msg))
            portConflict = true;
        checkReady(msg); // Uvicorn reports readiness on stderr, not stdout (#84).
        mainWindow?.webContents.send('python-status', msg);
    });
    child.on('error', (err) => {
        spawnFailed = true;
        // Spawn failure (binary missing, quarantined by AV, permissions) —
        // without this handler Node throws an uncaught exception and the
        // whole app crashes silently. Show the reason instead.
        const msg = `Failed to start the backend: ${err.message}`;
        backendLog?.write(`[err] ${msg}\n`);
        console.error(msg);
        electron_1.dialog.showErrorBox('Qrip — backend failed to start', `${msg}\n\n` +
            'Possible cause: antivirus software quarantined the backend\n' +
            '(unsigned apps are often flagged). Restore it from your\n' +
            'antivirus quarantine, add Qrip to the exclusions, and restart.\n\n' +
            '常见原因：杀毒软件（如 Windows Defender）隔离了后端程序\n' +
            '（未签名应用易被误报）。请在隔离区恢复该文件，把 Qrip\n' +
            '安装目录加入排除项，然后重启应用。\n\n' +
            `Log: ${backendLogPath()}`);
    });
    child.on('close', (code, signal) => {
        if (pythonProcess !== child)
            return;
        pythonProcess = null;
        backendLog?.write(`[exit] backend exited with code ${code}, signal ${signal}\n`);
        console.log(`[py] process exited with code ${code}`);
        if (quitting || spawnFailed || !mainWindow)
            return;
        if (!portConflict && backendRestarts < 2) {
            backendRestarts++;
            backendLog?.write(`[restart] restarting backend (${backendRestarts}/2)\n`);
            mainWindow.webContents.send('python-status', 'restarting');
            restartTimer = setTimeout(() => { restartTimer = null; startPython(); }, 1000);
            return;
        }
        mainWindow.webContents.send('python-status', 'failed');
        electron_1.dialog.showErrorBox('Qrip — backend stopped', portConflict
            ? `Port 8000 is already in use. Close other Qrip instances and restart.\n端口 8000 已被占用，请退出其他 Qrip 实例后重试。\n\nLog: ${backendLogPath()}`
            : `The backend stopped and could not recover (exit ${code}, signal ${signal}).\n后端异常退出，自动恢复未成功，请重启应用并提供日志。\n\nLog: ${backendLogPath()}`);
    });
}
function stopPython() {
    quitting = true;
    if (restartTimer)
        clearTimeout(restartTimer);
    const child = pythonProcess;
    pythonProcess = null;
    if (!child || child.exitCode !== null)
        return;
    try {
        if (process.platform === 'win32' && child.pid) {
            // PyInstaller can own a descendant server process. Kill only our
            // spawned tree so it cannot keep port 8000 after exit (#84).
            (0, child_process_1.execFileSync)('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
                stdio: 'ignore', windowsHide: true, timeout: 5000,
            });
        }
        else {
            child.kill();
        }
    }
    catch (err) {
        console.error('Backend cleanup failed:', err);
    }
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
        const oauthWindow = authWin;
        const oauthSession = oauthWindow.webContents.session;
        // If Qobuz is unreachable (network down, region block), the main frame
        // fails to load and the window would sit on Chromium's error page —
        // resolve with an error marker so the login page can explain.
        // (code -3 = ERR_ABORTED, fired on every redirect — ignore it.)
        authWin.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) {
                console.log(`[oauth] page load failed: ${code} ${desc}`);
                finish(JSON.stringify({ error: 'load-failed', code, desc }));
            }
        });
        let resolved = false;
        let pollInterval = null;
        let capturedToken = '';
        const finish = (token) => {
            if (resolved)
                return;
            resolved = true;
            if (pollInterval)
                clearInterval(pollInterval);
            oauthSession.webRequest.onBeforeSendHeaders(null);
            oauthWindow.removeAllListeners();
            if (!oauthWindow.isDestroyed())
                oauthWindow.close();
            // Drop the session's in-memory data so nothing lingers.
            // BrowserWindow.webContents is already destroyed after close (#84).
            void oauthSession.clearStorageData().catch(console.error);
            if (authWin === oauthWindow)
                authWin = null;
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
        // did-fail-load above supplies the user-visible error marker; consume
        // the matching rejected load promise instead of leaving it unhandled.
        void oauthWindow.loadURL(url).catch(() => { });
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
electron_1.app.on('second-instance', () => {
    if (!mainWindow)
        return;
    if (mainWindow.isMinimized())
        mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
});
if (!hasInstanceLock) {
    electron_1.app.quit();
}
else {
    void electron_1.app.whenReady().then(() => {
        startPython();
        createWindow();
    });
}
electron_1.app.on('window-all-closed', () => electron_1.app.quit());
electron_1.app.on('before-quit', stopPython);
