import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import Store from 'electron-store'

const store = new Store({ name: 'qrip-config' })
let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null

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
  if (app.isPackaged) {
    // Packaged: spawn the PyInstaller-built standalone backend binary.
    const binaryName = process.platform === 'win32' ? 'qrip-server.exe' : 'qrip-server'
    pythonProcess = spawn(path.join(process.resourcesPath, 'backend', binaryName), [], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
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
    if (msg.includes('Uvicorn running')) {
      mainWindow?.webContents.send('python-status', 'ready')
    }
  })

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[py:err] ${data}`)
    mainWindow?.webContents.send('python-status', data.toString())
  })

  pythonProcess.on('close', (code) => {
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

  mainWindow.on('closed', () => { mainWindow = null })
}

// IPC Handlers
ipcMain.handle('open-oauth', async (_e, url: string) => {
  return new Promise<string | null>((resolve) => {
    // Fresh in-memory partition every time — no cookies, no remembered
    // Google account. The user always starts from a clean login page.
    const partition = `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const authWin = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Qrip — Google Login',
      webPreferences: {
        partition,
      },
    })
    authWin.loadURL(url)

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
