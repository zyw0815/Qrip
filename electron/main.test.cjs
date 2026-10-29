const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

async function desktop({ lock = true, platform = 'darwin', spawnProcess } = {}) {
  const app = new EventEmitter()
  const children = [], windows = [], timers = [], errors = [], notices = [], treeKills = []
  const handlers = new Map()
  const log = new EventEmitter()
  log.write = () => true
  app.requestSingleInstanceLock = () => lock
  app.getVersion = () => '0.4.5'
  app.getPath = () => '/test/userData'
  app.whenReady = () => Promise.resolve()
  app.quitCount = 0
  app.quit = () => { app.quitCount++; app.emit('before-quit') }
  app.isPackaged = platform === 'win32'
  class Window extends EventEmitter {
    constructor() {
      super()
      this.statuses = []
      this.contents = new EventEmitter()
      this.contents.send = (...args) => this.statuses.push(args)
      this.contents.session = {
        webRequest: { onBeforeSendHeaders() {} },
        clearStorageData: async () => { this.storageCleared = true },
      }
      this.focusCount = 0
      windows.push(this)
    }
    loadFile() {}
    loadURL() { return Promise.resolve() }
    get webContents() {
      if (this.destroyed) throw Error('Object has been destroyed')
      return this.contents
    }
    isDestroyed() { return !!this.destroyed }
    close() { this.destroyed = true; this.emit('closed') }
    isMinimized() { return true }
    restore() { this.restored = true }
    show() {}
    focus() { this.focusCount++ }
  }
  const modules = {
    electron: { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {}, dialog: {
      showErrorBox: (...args) => errors.push(args),
      showMessageBox: (...args) => { notices.push(args); return Promise.resolve({}) },
    } },
    'child_process': {
      spawn: (...args) => {
        const child = spawnProcess ? spawnProcess(...args) : new EventEmitter()
        if (!spawnProcess) {
          child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
          child.pid = 501 + children.length; child.exitCode = null
          child.kill = () => { child.killed = true }
        }
        children.push(child)
        return child
      },
      execFileSync: (...args) => treeKills.push(args),
    },
    fs: { existsSync: () => false, createWriteStream: () => log },
    'electron-store': class Store {},
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist-electron/main.cjs'), 'utf8'), {
    require: name => name in modules ? modules[name] : require(name),
    exports: {}, __dirname,
    process: { platform, arch: 'arm64', env: {}, resourcesPath: '/test/resources' },
    console: { log() {}, error() {} },
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer },
    clearTimeout: timer => { timer.cancelled = true },
    setInterval, clearInterval,
  })
  await new Promise(resolve => setImmediate(resolve))
  return { app, children, windows, timers, errors, notices, treeKills, log, handlers }
}

test('a second application instance does not spawn a competing backend', async () => {
  const d = await desktop({ lock: false })
  assert.equal(d.children.length, 0)
  assert.equal(d.windows.length, 0)
  assert.equal(d.app.quitCount, 1)
})

test('opening again focuses the existing window without another backend', async () => {
  const d = await desktop()
  d.app.emit('second-instance')
  assert.equal(d.children.length, 1)
  assert.equal(d.windows[0].focusCount, 1)
  assert.equal(d.windows[0].restored, true)
})

test('readiness is detected on stderr and a crash recovers', async () => {
  const d = await desktop()
  d.children[0].stderr.emit('data', Buffer.from('Uvicorn running on http://127.0.0.1:8000'))
  assert.equal(d.windows[0].statuses.at(-2)[1], 'ready')
  d.children[0].emit('close', 1, null)
  assert.equal(d.timers.length, 1)
  d.timers[0].fn()
  assert.equal(d.children.length, 2)
  d.children[1].stderr.emit('data', Buffer.from('Uvicorn running on http://127.0.0.1:8000'))
  assert.equal(d.notices.length, 1)
  d.app.quit()
})

test('persistent crashes stop after two restarts and show a diagnostic', async () => {
  const d = await desktop()
  for (let i = 0; i < 2; i++) {
    d.children[i].emit('close', 1, null)
    d.timers[i].fn()
  }
  d.children[2].emit('close', 1, null)
  assert.equal(d.children.length, 3)
  assert.equal(d.timers.length, 2)
  assert.equal(d.errors.length, 1)
  assert.match(d.errors[0][1], /could not recover/)
})

test('a port conflict explains the collision without repeatedly spawning or killing others', async () => {
  const d = await desktop()
  d.children[0].stderr.emit('data', Buffer.from('[Errno 10048] bind failed'))
  d.children[0].emit('close', 3, null)
  assert.equal(d.timers.length, 0)
  assert.equal(d.treeKills.length, 0)
  assert.match(d.errors[0][1], /8000 is already in use/)
})

test('normal quit cancels recovery and terminates the owned backend', async () => {
  const d = await desktop()
  d.children[0].emit('close', 1, null)
  d.app.quit()
  assert.equal(d.timers[0].cancelled, true)
  d.timers[0].fn()
  assert.equal(d.children.length, 1)
  const active = await desktop()
  active.app.quit()
  assert.equal(active.children[0].killed, true)
})

test('Windows quit terminates only the spawned process tree', async () => {
  const d = await desktop({ platform: 'win32' })
  d.app.quit()
  assert.equal(d.treeKills.length, 1)
  assert.equal(d.treeKills[0][0], 'taskkill')
  assert.deepEqual(Array.from(d.treeKills[0][1]), ['/PID', '501', '/T', '/F'])
})

test('spawn and logging errors do not crash the app or create a retry loop', async () => {
  const d = await desktop()
  d.log.emit('error', new Error('log directory not writable'))
  d.children[0].emit('error', new Error('backend quarantined'))
  d.children[0].emit('close', -2, null)
  assert.equal(d.errors.length, 1)
  assert.equal(d.timers.length, 0)
})

test('closing OAuth does not access a destroyed webContents or crash the main window', async () => {
  const d = await desktop()
  const result = d.handlers.get('open-oauth')(null, 'https://play.qobuz.com/login')
  d.windows[1].close()
  assert.equal(await result, null)
  assert.equal(d.windows[1].storageCleared, true)
  assert.equal(d.app.quitCount, 0)
  d.app.quit()
})

test('OAuth page-load failure resolves an error and cleans its session', async () => {
  const d = await desktop()
  const result = d.handlers.get('open-oauth')(null, 'https://play.qobuz.com/login')
  d.windows[1].contents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', '', true)
  assert.equal(JSON.parse(await result).error, 'load-failed')
  assert.equal(d.windows[1].storageCleared, true)
  d.app.quit()
})

// The same compiled process supervisor is also exercised against a real
// Python HTTP child, isolated from the user's application on port 8000.
test('real HTTP backend recovers after being killed, then exits cleanly', async () => {
  const { spawn } = require('node:child_process')
  const http = require('node:http')
  const net = require('node:net')
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const localPython = '/opt/anaconda3/envs/music/bin/python3'
  const python = process.env.QRIP_TEST_PYTHON || (fs.existsSync(localPython) ? localPython : 'python')
  const d = await desktop({ spawnProcess: () => spawn(python, ['-m', 'http.server', String(port), '--bind', '127.0.0.1']) })
  const reachable = () => new Promise(resolve => {
    const request = http.get(`http://127.0.0.1:${port}/`, response => { response.resume(); resolve(true) })
    request.on('error', () => resolve(false))
    request.setTimeout(500, () => { request.destroy(); resolve(false) })
  })
  async function until(condition) {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('backend lifecycle timed out')
  }
  try {
    await until(reachable)
    d.children[0].kill('SIGKILL')
    await until(() => d.timers.length === 1)
    d.timers[0].fn()
    await until(reachable)
    assert.equal(d.children.length, 2)
    d.app.quit()
    await until(async () => !await reachable())
  } finally {
    for (const child of d.children) if (child.exitCode === null) child.kill('SIGKILL')
  }
})
