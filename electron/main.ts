import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import Store from 'electron-store'

const store = new Store({ name: 'qrip-config' })
let mainWindow: BrowserWindow | null = null
let authWin: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null

// All backend output goes here so users can send it for diagnostics —
// the Electron console is invisible in packaged builds.
function backendLogPath() {
  return path.join(app.getPath('userData'), 'backend.log')
}
let backendLog: fs.WriteStream | null = null

// Qobuz sends X-User-Auth-Token header on authenticated API requests.
// Intercept it during the OAuth window's session to capture credentials.
function interceptQobuzAuth(session: Electron.Session, onCaptured: (token: string) => void) {
  session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.qobuz.com/*', '*://play.qobuz.com/*'] },
    (details, callback) => {
      const authToken = details.requestHeaders['X-User-Auth-Token']
      if (authToken && typeof authToken === 'string' && authToken.length > 10) {
        onCaptured(authToken)
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

function startPython() {
  // Roll the log when it grows past 1MB — it's for diagnostics, not history.
  try {
    if (fs.existsSync(backendLogPath()) && fs.statSync(backendLogPath()).size > 1024 * 1024) {
      fs.writeFileSync(backendLogPath(), '[log rolled]\n')
    }
  } catch {
    // userData unreadable — logging will just fail silently below
  }
  backendLog = fs.createWriteStream(backendLogPath(), { flags: 'a' })
  backendLog.write(
    `\n=== Qrip ${app.getVersion()} (${process.platform} ${process.arch}) starting backend ===\n`,
  )

  if (app.isPackaged) {
    // Packaged: spawn the PyInstaller-built standalone backend binary.
    // onedir layout: resources/backend/qrip-server/qrip-server(.exe)
    const binaryName = process.platform === 'win32' ? 'qrip-server.exe' : 'qrip-server'
    pythonProcess = spawn(
      path.join(process.resourcesPath, 'backend', 'qrip-server', binaryName),
      [],
      { env: { ...process.env, PYTHONUNBUFFERED: '1' } },
    )
  } else {
    // Dev: use the conda env python directly.
    pythonProcess = spawn(
      '/opt/anaconda3/envs/music/bin/python3',
      [path.join(__dirname, '..', 'python', 'server.py')],
      { env: { ...process.env, PYTHONUNBUFFERED: '1' } },
    )
  }

  pythonProcess.stdout?.on('data', (data) => {
    const msg = data.toString()
    console.log(`[py] ${msg}`)
    backendLog?.write(`[out] ${msg}`)
    if (msg.includes('Uvicorn running')) {
      mainWindow?.webContents.send('python-status', 'ready')
    }
  })

  pythonProcess.stderr?.on('data', (data) => {
    const msg = data.toString()
    console.error(`[py:err] ${msg}`)
    backendLog?.write(`[err] ${msg}`)
    mainWindow?.webContents.send('python-status', msg)
  })

  pythonProcess.on('error', (err) => {
    // Spawn failure (binary missing, quarantined by AV, permissions) —
    // without this handler Node throws an uncaught exception and the
    // whole app crashes silently. Show the reason instead.
    const msg = `Failed to start the backend: ${err.message}`
    backendLog?.write(`[err] ${msg}\n`)
    console.error(msg)
    dialog.showErrorBox(
      'Qrip — backend failed to start',
      `${msg}\n\n` +
        'Possible cause: antivirus software quarantined the backend\n' +
        '(unsigned apps are often flagged). Restore it from your\n' +
        'antivirus quarantine, add Qrip to the exclusions, and restart.\n\n' +
        '常见原因：杀毒软件（如 Windows Defender）隔离了后端程序\n' +
        '（未签名应用易被误报）。请在隔离区恢复该文件，把 Qrip\n' +
        '安装目录加入排除项，然后重启应用。\n\n' +
        `Log: ${backendLogPath()}`,
    )
  })

  pythonProcess.on('close', (code) => {
    backendLog?.write(`[exit] backend exited with code ${code}\n`)
    console.log(`[py] process exited with code ${code}`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#08080f',
    titleBarStyle: 'hiddenInset',
    title: 'Qrip',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // Closing the main window quits the app, even if the OAuth window is
    // still open (window-all-closed wouldn't fire while it exists).
    if (authWin && !authWin.isDestroyed()) authWin.close()
    app.quit()
  })
}

// IPC Handlers
ipcMain.handle('open-oauth', async (_e, url: string) => {
  return new Promise<string | null>((resolve) => {
    // Fresh in-memory partition every time — no cookies, no remembered
    // Google account. The user always starts from a clean login page.
    const partition = `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`
    authWin = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Qrip — Google Login',
      webPreferences: {
        partition,
      },
    })
    authWin.loadURL(url)

    // If Qobuz is unreachable (network down, region block), the main frame
    // fails to load and the window would sit on Chromium's error page —
    // resolve with an error marker so the login page can explain.
    // (code -3 = ERR_ABORTED, fired on every redirect — ignore it.)
    authWin.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        console.log(`[oauth] page load failed: ${code} ${desc}`)
        finish(JSON.stringify({ error: 'load-failed', code, desc }))
      }
    })

    let resolved = false
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let capturedToken = ''

    const finish = (token: string | null) => {
      if (resolved) return
      resolved = true
      if (pollInterval) clearInterval(pollInterval)
      authWin.webContents.session.webRequest.onBeforeSendHeaders(null)
      authWin.removeAllListeners()
      if (!authWin.isDestroyed()) authWin.close()
      // Drop the session's in-memory data so nothing lingers.
      authWin.webContents.session.clearStorageData()
      resolve(token)
    }

    // Capture X-User-Auth-Token from any authenticated Qobuz API call.
    // This is the reliable way — the web player sends it on every
    // request after login.
    interceptQobuzAuth(authWin.webContents.session, (token) => {
      if (resolved) return
      console.log(`[oauth] captured X-User-Auth-Token (${token.length} chars)`)
      capturedToken = token
    })

    // Poll every 2s — once we have a captured token, pair it with
    // the user id from localStorage and finish.
    pollInterval = setInterval(async () => {
      if (resolved || !capturedToken) return
      try {
        let userId = ''
        const localUser = await authWin.webContents.executeJavaScript(
          `localStorage.getItem('localuser') || ''`,
        )
        try {
          const parsed = JSON.parse(localUser)
          if (parsed.id) userId = String(parsed.id)
          else {
            const m = localUser.match(/"id":(\d+)/)
            if (m) userId = m[1]
          }
        } catch { /* ignore */ }
        console.log(`[oauth] poll: token=YES, userId=${userId || 'no'}`)
        if (userId) finish(JSON.stringify({ token: capturedToken, userId }))
      } catch (err) {
        console.log(`[oauth] poll error: ${err}`)
      }
    }, 2000)

    authWin.on('closed', () => finish(null))
  })
})

ipcMain.handle('store:get', (_e, key: string) => store.get(key))
ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
  store.set(key, value)
  return true
})
ipcMain.handle('store:delete', (_e, key: string) => {
  store.delete(key)
  return true
})
ipcMain.handle('get-download-path', () => app.getPath('music'))

ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select download folder',
    defaultPath: app.getPath('music'),
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('open-external', async (_e, url: string) => {
  // Only allow http/https links — anything else is refused.
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})

ipcMain.handle('app-version', () => app.getVersion())

app.whenReady().then(() => {
  startPython()
  createWindow()
})

app.on('window-all-closed', () => {
  pythonProcess?.kill()
  app.quit()
})

app.on('before-quit', () => {
  pythonProcess?.kill()
})
