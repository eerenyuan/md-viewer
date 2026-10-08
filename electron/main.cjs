const { app, BrowserWindow, ipcMain, protocol, net, nativeTheme, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const SUPPORTED = /\.(md|markdown|mkd|mdown|excalidraw|excalidraw\.md|excalidraw\.json)$/i

// Dev builds get their own userData so the single-instance lock never fights
// with an installed copy of the app.
if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '..', '.dev-profile'))
}

// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

let win = null
let openTabs = [] // [{ path, content }]
let activePath = null
const watchers = new Map() // path -> { watcher, timer }

function extractFileArg(argv) {
  return argv.find((a) => SUPPORTED.test(a) && !a.startsWith('-') && !a.startsWith('local-file'))
}

function tabOf(p) {
  return openTabs.find((t) => t.path === p)
}

function broadcastTabs() {
  win?.webContents.send('tabs-changed', {
    tabs: openTabs.map((t) => ({ path: t.path, stale: !!t.stale })),
    activePath,
  })
}

function sendContent(p) {
  const tab = tabOf(p)
  if (tab) win?.webContents.send('content-updated', { path: p, content: tab.content })
}

function syncTitle() {
  if (win && !win.isDestroyed()) {
    const tab = tabOf(activePath)
    win.setTitle(tab ? `${path.basename(tab.path)} - MD Viewer` : 'MD Viewer')
  }
}

function watchTab(p) {
  if (watchers.has(p)) return
  const dir = path.dirname(p)
  const base = path.basename(p)
  try {
    const watcher = fs.watch(dir, (_event, filename) => {
      if (filename && path.basename(filename) !== base) return
      clearTimeout(watchers.get(p)?.timer)
      const timer = setTimeout(async () => {
        try {
          const content = await fsp.readFile(p, 'utf8')
          const tab = tabOf(p)
          // Don't clobber the view: flag the tab as stale and let the user
          // decide whether to reload (banner with reload/dismiss buttons).
          if (!tab || content === tab.content) return
          tab.stale = true
          win?.webContents.send('file-changed', { path: p })
        } catch {
          /* file may be mid-save; retry on next event */
        }
      }, 250)
      const entry = watchers.get(p)
      if (entry) entry.timer = timer
    })
    watchers.set(p, { watcher, timer: null })
  } catch {
    /* watch is best-effort */
  }
}

function unwatchTab(p) {
  const entry = watchers.get(p)
  if (entry) {
    clearTimeout(entry.timer)
    entry.watcher.close()
    watchers.delete(p)
  }
}

async function openFile(filePath) {
  try {
    filePath = path.resolve(filePath)
    await fsp.access(filePath)
  } catch {
    return
  }
  const existing = tabOf(filePath)
  if (existing) {
    // External changes surface as a stale banner (user decides), so activating
    // an already-open tab must not silently refresh its content either.
    activePath = filePath
  } else {
    const content = await fsp.readFile(filePath, 'utf8').catch(() => '')
    openTabs.push({ path: filePath, content })
    activePath = filePath
    watchTab(filePath)
  }
  broadcastTabs()
  sendContent(activePath)
  syncTitle()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

function activateTab(p) {
  if (!tabOf(p)) return
  activePath = p
  broadcastTabs()
  sendContent(p)
  syncTitle()
}

function closeTab(p) {
  const idx = openTabs.findIndex((t) => t.path === p)
  if (idx === -1) return
  openTabs.splice(idx, 1)
  unwatchTab(p)
  if (activePath === p) {
    activePath = openTabs[Math.min(idx, openTabs.length - 1)]?.path ?? null
  }
  broadcastTabs()
  if (activePath) sendContent(activePath)
  syncTitle()
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    // dev runs show this icon in the taskbar too (packaged builds use the
    // embedded exe icon) — keeps "blue M" consistent across both
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {})
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = extractFileArg(argv)
    if (f) openFile(f)
    else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    protocol.handle('local-file', (request) => {
      let p = decodeURIComponent(new URL(request.url).pathname)
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      return net.fetch(pathToFileURL(p).toString())
    })

    ipcMain.handle('get-state', () => ({
      tabs: openTabs.map((t) => ({ path: t.path, stale: !!t.stale })),
      activePath,
    }))
    ipcMain.handle('reload-tab', async (_e, p) => {
      const tab = tabOf(p)
      if (typeof p !== 'string' || !tab) return
      try {
        const content = await fsp.readFile(p, 'utf8')
        tab.content = content
        tab.stale = false
        broadcastTabs()
        sendContent(p)
      } catch {
        /* keep cached content */
      }
    })
    ipcMain.handle('dismiss-file-changed', (_e, p) => {
      const tab = tabOf(p)
      if (typeof p !== 'string' || !tab) return
      tab.stale = false
      broadcastTabs()
    })
    ipcMain.handle('get-tab-content', (_e, p) => tabOf(p)?.content ?? null)
    ipcMain.handle('activate-tab', (_e, p) => {
      if (typeof p === 'string') activateTab(p)
    })
    ipcMain.handle('close-tab', (_e, p) => {
      if (typeof p === 'string') closeTab(p)
    })
    ipcMain.handle('open-path', (_e, filePath) => {
      if (typeof filePath === 'string' && SUPPORTED.test(filePath)) openFile(filePath)
    })
    ipcMain.handle('set-theme-source', (_e, src) => {
      if (['system', 'light', 'dark'].includes(src)) nativeTheme.themeSource = src
    })
    ipcMain.handle('save-file', async (_e, filePath, content) => {
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        return { ok: false, error: 'bad args' }
      }
      try {
        await fsp.writeFile(filePath, content, 'utf8')
        const tab = tabOf(filePath)
        if (tab) tab.content = content
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
    ipcMain.handle('export-pdf', async (_e, opts) => {
      if (!win || win.isDestroyed()) return { ok: false, error: 'no window' }
      try {
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        })
        let target = typeof opts?.autoPath === 'string' ? opts.autoPath : null
        if (!target) {
          const base = activePath ? path.basename(activePath).replace(/\.[^.]+$/, '') : 'document'
          const r = await dialog.showSaveDialog(win, {
            title: '导出 PDF',
            defaultPath: `${base}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          })
          if (r.canceled || !r.filePath) return { ok: false, canceled: true }
          target = r.filePath
        }
        await fsp.writeFile(target, pdf)
        return { ok: true, path: target }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
    ipcMain.handle('resolve-embed', async (_e, baseDir, ref) => {
      if (typeof baseDir !== 'string' || typeof ref !== 'string') return null
      const refClean = ref.split('#')[0].split('|')[0].trim()
      if (!refClean || refClean.includes('..')) return null
      const exts = ['', '.excalidraw.md', '.excalidraw', '.excalidraw.json']
      const candidates = []
      for (const ext of exts) candidates.push(path.join(baseDir, refClean + ext))
      if (!refClean.includes('/') && !refClean.includes('\\')) {
        let dir = baseDir
        for (let i = 0; i < 6; i++) {
          for (const ext of exts) candidates.push(path.join(dir, refClean + ext))
          const parent = path.dirname(dir)
          if (parent === dir) break
          dir = parent
        }
      }
      for (const c of candidates) {
        try {
          const st = await fsp.stat(c)
          if (st.isFile() && st.size < 50 * 1024 * 1024) return c
        } catch {
          /* not there */
        }
      }
      return null
    })
    ipcMain.handle('read-embed', async (_e, filePath) => {
      if (typeof filePath !== 'string' || !SUPPORTED.test(filePath)) {
        return { ok: false, error: 'unsupported' }
      }
      try {
        const content = await fsp.readFile(filePath, 'utf8')
        return { ok: true, content }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })

    createWindow()

    // File passed on the command line (double-click / "open with")
    const cli = extractFileArg(process.argv)
    if (cli) openFile(cli)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    for (const entry of watchers.values()) entry.watcher.close()
    watchers.clear()
    app.quit()
  })
}
