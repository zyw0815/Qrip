import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import Store from 'electron-store'

const store = new Store({ name: 'qrip-config' })
let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null

function startPython() {
  const pythonPath = app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'venv', 'bin', 'python3')
    : '/opt/anaconda3/envs/music/bin/python3'
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'python', 'server.py')
    : path.join(__dirname, '..', 'python', 'server.py')

  pythonProcess = spawn(pythonPath, [scriptPath], {
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

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
    const authWin = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Qrip — Google Login',
    })
    authWin.loadURL(url)

    let resolved = false
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const finish = (token: string | null) => {
      if (resolved) return
      resolved = true
      if (pollInterval) clearInterval(pollInterval)
      authWin.removeAllListeners()
      if (!authWin.isDestroyed()) authWin.close()
      resolve(token)
    }

    // Poll every 2s — login completes asynchronously; the auth cookie
    // appears only after the Google→Qobuz handshake finishes.
    pollInterval = setInterval(async () => {
      if (resolved) return
      const currentUrl = authWin.webContents.getURL()
      if (!currentUrl.includes('play.qobuz.com') && !currentUrl.includes('qobuz.com')) return
      try {
        // Session API sees HttpOnly cookies too
        const cookies = await authWin.webContents.session.cookies.get({ url: 'https://play.qobuz.com' })
        let token = ''
        // Qobuz stores credentials in 'userCookie' (JSON with user_auth_token)
        for (const c of cookies) {
          if (c.name === 'userCookie' && c.value.length > 10) {
            try {
              const parsed = JSON.parse(decodeURIComponent(c.value))
              token = parsed.user_auth_token || parsed.authToken || ''
            } catch {
              // maybe raw value
              token = c.value
            }
          }
          if (!token && c.name.toLowerCase().includes('auth_token') && c.value.length > 10) {
            token = c.value
          }
        }
        if (token) {
          let userId = ''
          try {
            const localUser = await authWin.webContents.executeJavaScript(
              `localStorage.getItem('localuser') || ''`,
            )
            const parsed = JSON.parse(localUser)
            if (parsed.id) userId = String(parsed.id)
            else {
              const m = localUser.match(/"id":(\d+)/)
              if (m) userId = m[1]
            }
          } catch { /* ignore */ }
          console.log(`[oauth] poll: token=${token ? 'YES' : 'no'}, userId=${userId || 'no'}`)
          if (userId) finish(JSON.stringify({ token, userId }))
        }
      } catch (err) {
        console.log(`[oauth] poll error: ${err}`)
      }
    }, 2000)

    authWin.on('closed', () => finish(null))

    // Qobuz stores user_auth_token in a cookie (not localStorage).
    // localStorage has 'localuser' with the user id.
    authWin.webContents.on('did-finish-load', async () => {
      const currentUrl = authWin.webContents.getURL()
      console.log(`[oauth] page loaded: ${currentUrl}`)
      // Only extract when we're on the Qobuz player domain (login finished)
      if (!currentUrl.includes('play.qobuz.com') && !currentUrl.includes('qobuz.com')) return

      try {
        // Session API sees HttpOnly cookies too
        const cookies = await authWin.webContents.session.cookies.get({ url: 'https://play.qobuz.com' })
        let token = ''
        // Qobuz stores credentials in 'userCookie' (JSON with user_auth_token)
        for (const c of cookies) {
          if (c.name === 'userCookie' && c.value.length > 10) {
            try {
              const parsed = JSON.parse(decodeURIComponent(c.value))
              token = parsed.user_auth_token || parsed.authToken || ''
            } catch {
              // maybe raw value
              token = c.value
            }
          }
          if (!token && c.name.toLowerCase().includes('auth_token') && c.value.length > 10) {
            token = c.value
          }
        }

        // Fallback: document.cookie + localStorage scan
        if (!token) {
          const jsResult = await authWin.webContents.executeJavaScript(
            `(() => {
              let t = ''
              const cs = document.cookie.split(';')
              for (const c of cs) {
                const [name, ...rest] = c.trim().split('=')
                const val = rest.join('=')
                if (name === 'userCookie' && val.length > 10) {
                  try {
                    const p = JSON.parse(decodeURIComponent(val))
                    if (p.user_auth_token) t = p.user_auth_token
                  } catch { t = val }
                }
                if (!t && name.toLowerCase().includes('auth_token') && val.length > 10) t = val
              }
              if (!t) {
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i) || ''
                  const val = localStorage.getItem(key) || ''
                  if (key.toLowerCase().includes('auth_token') && val.length > 10) t = val
                }
              }
              return t
            })()`,
          )
          if (jsResult && jsResult.length > 10) token = jsResult
        }

        // User id from localuser key
        let userId = ''
        const localUser = await authWin.webContents.executeJavaScript(
          `localStorage.getItem('localuser') || ''`,
        )
        try {
          const parsed = JSON.parse(localUser)
          if (parsed.id) userId = String(parsed.id)
        } catch {
          const m = localUser.match(/"id":(\d+)/)
          if (m) userId = m[1]
        }

        console.log(`[oauth] token found: ${token ? 'YES (' + token.length + ' chars)' : 'no'}, userId: ${userId || 'no'}`)
        if (token && token.length > 10 && userId) {
          finish(JSON.stringify({ token, userId }))
        }
      } catch (err) {
        console.log(`[oauth] scan error: ${err}`)
      }
    })
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
