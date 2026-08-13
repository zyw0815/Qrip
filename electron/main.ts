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
    const finish = (token: string | null) => {
      if (resolved) return
      resolved = true
      authWin.removeAllListeners()
      if (!authWin.isDestroyed()) authWin.close()
      resolve(token)
    }

    // Qobuz stores user_auth_token in localStorage after successful login.
    // Poll for it once the page finishes loading.
    authWin.webContents.on('did-finish-load', async () => {
      const currentUrl = authWin.webContents.getURL()
      // Only extract when we're on the Qobuz player domain (login finished)
      if (!currentUrl.includes('play.qobuz.com') && !currentUrl.includes('qobuz.com')) return

      try {
        const result = await authWin.webContents.executeJavaScript(
          `(() => {
            let token = ''
            let userId = ''
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i) || ''
              const val = localStorage.getItem(key) || ''
              if (key.toLowerCase().includes('auth_token') && val.length > 10) token = val
              if (!userId && key.toLowerCase().includes('user') && key.toLowerCase().includes('id') && val && val.length > 0) userId = val
            }
            return JSON.stringify({ token, userId })
          })()`,
        )
        const { token, userId } = JSON.parse(result)
        if (token && typeof token === 'string' && token.length > 10 && userId) {
          finish(JSON.stringify({ token, userId }))
        }
      } catch {
        // ignore — try again on next load
      }
    })

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
