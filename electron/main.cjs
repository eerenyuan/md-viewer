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

// Multi-window: every window owns an independent tab set. `lastFocusedId`
// routes files opened externally (double-click / second instance).
const wins = new Map() // id -> { win, openTabs, activePath }
let lastFocusedId = null
const watchers = new Map() // path -> { watcher, timer, refs: Set<number> }

// --- session persistence: restore open tabs per window on launch ---

function sessionFile() {
  return path.join(app.getPath('userData'), 'session.json')
}

function saveSession() {
  try {
    fs.writeFileSync(
      sessionFile(),
      JSON.stringify({
        windows: [...wins.values()].map((w) => ({
          tabs: w.openTabs.map((t) => t.path),
          activePath: w.activePath,
        })),
      }),
    )
  } catch {
    /* best-effort */
  }
}

function createWindow() {
  const win = new BrowserWindow({
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
  const id = win.id
  wins.set(id, { win, openTabs: [], activePath: null })
  win.on('focus', () => {
    lastFocusedId = id
  })
  win.on('closed', () => {
    const w = wins.get(id)
    if (w) {
      for (const t of w.openTabs) unwatchTab(id, t.path)
      wins.delete(id)
    }
    if (lastFocusedId === id) lastFocusedId = null
    // Only re-save while other windows remain: when the LAST window closes,
    // writing now would persist an empty session and wipe the tabs the user
    // just had open (the last broadcastTabs already recorded them)
    if (wins.size > 0) saveSession()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {})
  lastFocusedId = id
  return id
}

function entryOf(id) {
  return wins.get(id)
}

function tabOf(id, p) {
  return wins.get(id)?.openTabs.find((t) => t.path === p)
}

function broadcastTabs(id) {
  const w = wins.get(id)
  w?.win?.webContents.send('tabs-changed', {
    tabs: w.openTabs.map((t) => ({ path: t.path, stale: !!t.stale })),
    activePath: w.activePath,
  })
  saveSession()
}

function sendContent(id, p) {
  const tab = tabOf(id, p)
  if (tab) wins.get(id)?.win?.webContents.send('content-updated', { path: p, content: tab.content })
}

function syncTitle(id) {
  const w = wins.get(id)
  if (w && w.win && !w.win.isDestroyed()) {
    const tab = w.openTabs.find((t) => t.path === w.activePath)
    w.win.setTitle(tab ? `${path.basename(tab.path)} - MD Viewer` : 'MD Viewer')
  }
}

function watchTab(id, p) {
  let entry = watchers.get(p)
  if (entry) {
    entry.refs.add(id)
    return
  }
  const dir = path.dirname(p)
  const base = path.basename(p)
  try {
    const watcher = fs.watch(dir, (_event, filename) => {
      if (filename && path.basename(filename) !== base) return
      clearTimeout(watchers.get(p)?.timer)
      const timer = setTimeout(async () => {
        try {
          const content = await fsp.readFile(p, 'utf8')
          // flag the tab as stale in every window that has it open and let
          // each user decide whether to reload (banner with reload/dismiss)
          for (const [wid, w] of wins) {
            const tab = w.openTabs.find((t) => t.path === p)
            if (tab && content !== tab.content) {
              tab.stale = true
              w.win?.webContents.send('file-changed', { path: p })
            }
          }
        } catch {
          /* file may be mid-save; retry on next event */
        }
      }, 250)
      const cur = watchers.get(p)
      if (cur) cur.timer = timer
    })
    entry = { watcher, timer: null, refs: new Set([id]) }
    watchers.set(p, entry)
  } catch {
    /* watch is best-effort */
  }
}

function unwatchTab(id, p) {
  const entry = watchers.get(p)
  if (!entry) return
  entry.refs.delete(id)
  if (entry.refs.size === 0) {
    clearTimeout(entry.timer)
    entry.watcher.close()
    watchers.delete(p)
  }
}

async function openFile(filePath, targetId) {
  const id =
    targetId ?? lastFocusedId ?? (wins.size ? [...wins.keys()][0] : createWindow())
  try {
    filePath = path.resolve(filePath)
    await fsp.access(filePath)
  } catch {
    return
  }
  const w = entryOf(id)
  if (!w) return
  const existing = w.openTabs.find((t) => t.path === filePath)
  if (existing) {
    // External changes surface as a stale banner (user decides), so activating
    // an already-open tab must not silently refresh its content either.
    w.activePath = filePath
  } else {
    const content = await fsp.readFile(filePath, 'utf8').catch(() => '')
    w.openTabs.push({ path: filePath, content })
    w.activePath = filePath
    watchTab(id, filePath)
  }
  broadcastTabs(id)
  sendContent(id, w.activePath)
  syncTitle(id)
  if (w.win && !w.win.isDestroyed()) {
    if (w.win.isMinimized()) w.win.restore()
    w.win.focus()
  }
}

function activateTab(id, p) {
  const w = entryOf(id)
  if (!w || !w.openTabs.find((t) => t.path === p)) return
  w.activePath = p
  broadcastTabs(id)
  sendContent(id, p)
  syncTitle(id)
}

function closeTab(id, p) {
  const w = entryOf(id)
  if (!w) return
  const idx = w.openTabs.findIndex((t) => t.path === p)
  if (idx === -1) return
  w.openTabs.splice(idx, 1)
  unwatchTab(id, p)
  if (w.activePath === p) {
    w.activePath = w.openTabs[Math.min(idx, w.openTabs.length - 1)]?.path ?? null
  }
  broadcastTabs(id)
  if (w.activePath) sendContent(id, w.activePath)
  syncTitle(id)
}

async function restoreSession() {
  let data
  try {
    data = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'))
  } catch {
    return
  }
  // accept both the new multi-window format and the legacy single-window one
  const windows = Array.isArray(data.windows)
    ? data.windows
    : Array.isArray(data.tabs)
      ? [{ tabs: data.tabs, activePath: data.activePath }]
      : []
  let first = true
  for (const wdata of windows) {
    if (!Array.isArray(wdata?.tabs) || wdata.tabs.length === 0) continue
    const id = first ? [...wins.keys()][0] : createWindow()
    first = false
    for (const p of wdata.tabs) {
      if (typeof p === 'string') await openFile(p, id) // skips files that no longer exist
    }
    if (typeof wdata.activePath === 'string' && tabOf(id, wdata.activePath)) {
      activateTab(id, wdata.activePath)
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = extractFileArg(argv)
    if (f) openFile(f)
    else {
      const id = lastFocusedId ?? (wins.size ? [...wins.keys()][0] : createWindow())
      const w = entryOf(id)
      if (w?.win && !w.win.isDestroyed()) {
        if (w.win.isMinimized()) w.win.restore()
        w.win.focus()
      }
    }
  })

  app.whenReady().then(async () => {
    protocol.handle('local-file', (request) => {
      let p = decodeURIComponent(new URL(request.url).pathname)
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
      return net.fetch(pathToFileURL(p).toString())
    })

    ipcMain.handle('get-state', (e) => {
      const w = entryOf(e.sender.id)
      return w
        ? { tabs: w.openTabs.map((t) => ({ path: t.path, stale: !!t.stale })), activePath: w.activePath }
        : { tabs: [], activePath: null }
    })
    ipcMain.handle('reload-tab', async (e, p) => {
      const id = e.sender.id
      const tab = tabOf(id, p)
      if (typeof p !== 'string' || !tab) return
      try {
        const content = await fsp.readFile(p, 'utf8')
        tab.content = content
        tab.stale = false
        broadcastTabs(id)
        sendContent(id, p)
      } catch {
        /* keep cached content */
      }
    })
    ipcMain.handle('dismiss-file-changed', (e, p) => {
      const id = e.sender.id
      const tab = tabOf(id, p)
      if (typeof p !== 'string' || !tab) return
      tab.stale = false
      broadcastTabs(id)
    })
    ipcMain.handle('get-tab-content', (e, p) => tabOf(e.sender.id, p)?.content ?? null)
    ipcMain.handle('activate-tab', (e, p) => {
      if (typeof p === 'string') activateTab(e.sender.id, p)
    })
    ipcMain.handle('close-tab', (e, p) => {
      if (typeof p === 'string') closeTab(e.sender.id, p)
    })
    ipcMain.handle('open-new-window', () => {
      createWindow()
    })
    ipcMain.handle('tear-out-tab', (e, p) => {
      const srcId = e.sender.id
      const w = entryOf(srcId)
      if (typeof p !== 'string' || !w) return
      const idx = w.openTabs.findIndex((t) => t.path === p)
      if (idx === -1) return
      // move the tab (with its cached content) into a brand-new window
      const [tab] = w.openTabs.splice(idx, 1)
      unwatchTab(srcId, p)
      if (w.activePath === p) {
        w.activePath = w.openTabs[Math.min(idx, w.openTabs.length - 1)]?.path ?? null
      }
      const newId = createWindow()
      const nw = entryOf(newId)
      nw.openTabs.push(tab)
      nw.activePath = p
      watchTab(newId, p)
      broadcastTabs(srcId)
      if (w.activePath) sendContent(srcId, w.activePath)
      syncTitle(srcId)
      broadcastTabs(newId)
      sendContent(newId, p)
      syncTitle(newId)
    })
    // End of a tab drag: dock into another window when released over its top
    // area, otherwise detach into a new window.
    ipcMain.handle('tab-drag-end', (e, p, screenX, screenY) => {
      const srcId = e.sender.id
      const w = entryOf(srcId)
      if (
        typeof p !== 'string' || !w ||
        typeof screenX !== 'number' || typeof screenY !== 'number'
      ) return
      const idx = w.openTabs.findIndex((t) => t.path === p)
      if (idx === -1) return

      // find another window whose top strip contains the release point
      let targetId = null
      for (const [id, tw] of wins) {
        if (id === srcId || tw.win.isDestroyed()) continue
        const b = tw.win.getBounds()
        const topStrip = Math.min(110, b.height)
        if (screenX >= b.x && screenX <= b.x + b.width && screenY >= b.y && screenY <= b.y + topStrip) {
          targetId = id
          break
        }
      }

      if (targetId === null) {
        // free area -> detach into a new window (classic tear-off)
        const [tab] = w.openTabs.splice(idx, 1)
        unwatchTab(srcId, p)
        if (w.activePath === p) {
          w.activePath = w.openTabs[Math.min(idx, w.openTabs.length - 1)]?.path ?? null
        }
        const newId = createWindow()
        const nw = entryOf(newId)
        nw.openTabs.push(tab)
        nw.activePath = p
        watchTab(newId, p)
        broadcastTabs(srcId)
        if (w.activePath) sendContent(srcId, w.activePath)
        syncTitle(srcId)
        broadcastTabs(newId)
        sendContent(newId, p)
        syncTitle(newId)
        return
      }

      // dock into the target window
      const tw = entryOf(targetId)
      const existing = tw.openTabs.find((t) => t.path === p)
      const [tab] = w.openTabs.splice(idx, 1)
      unwatchTab(srcId, p)
      if (w.activePath === p) {
        w.activePath = w.openTabs[Math.min(idx, w.openTabs.length - 1)]?.path ?? null
      }
      if (existing) {
        // already open there — keep the target's copy, but don't lose a stale flag
        if (tab.stale) existing.stale = true
        tw.activePath = existing.path
      } else {
        tw.openTabs.push(tab)
        tw.activePath = p
        watchTab(targetId, p)
      }
      broadcastTabs(srcId)
      if (w.activePath) sendContent(srcId, w.activePath)
      syncTitle(srcId)
      broadcastTabs(targetId)
      sendContent(targetId, tw.activePath)
      syncTitle(targetId)
      tw.win.focus()
    })
    ipcMain.handle('open-path', (e, filePath) => {
      if (typeof filePath === 'string' && SUPPORTED.test(filePath)) openFile(filePath, e.sender.id)
    })
    ipcMain.handle('set-theme-source', (_e, src) => {
      if (['system', 'light', 'dark'].includes(src)) nativeTheme.themeSource = src
    })
    ipcMain.handle('save-file', async (e, filePath, content) => {
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        return { ok: false, error: 'bad args' }
      }
      try {
        await fsp.writeFile(filePath, content, 'utf8')
        // the tab cache follows in every window showing this file
        for (const [, w] of wins) {
          const tab = w.openTabs.find((t) => t.path === filePath)
          if (tab) tab.content = content
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
    ipcMain.handle('rename-file', async (e, oldPath, newName) => {
      const id = e.sender.id
      if (typeof oldPath !== 'string' || typeof newName !== 'string') {
        return { ok: false, error: 'bad args' }
      }
      const tab = tabOf(id, oldPath)
      if (!tab) return { ok: false, error: 'tab not found' }
      const name = newName.trim()
      if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
        return { ok: false, error: '文件名不能包含 \\ / : * ? " < > | 或为空' }
      }
      if (name === path.basename(oldPath)) return { ok: true, path: oldPath }
      const dir = path.dirname(oldPath)
      const newPath = path.join(dir, name)
      // Windows is case-insensitive: a pure case change renames onto itself
      if (newPath.toLowerCase() !== oldPath.toLowerCase()) {
        try {
          await fsp.access(newPath)
          return { ok: false, error: `已存在同名文件：${name}` }
        } catch {
          /* target free — proceed */
        }
      }
      try {
        await fsp.rename(oldPath, newPath)
      } catch (err) {
        return { ok: false, error: String(err) }
      }
      // migrate the tab in every window that has this file open
      for (const [wid, w] of wins) {
        const t = w.openTabs.find((x) => x.path === oldPath)
        if (!t) continue
        t.path = newPath
        unwatchTab(wid, oldPath)
        watchTab(wid, newPath)
        if (w.activePath === oldPath) w.activePath = newPath
        broadcastTabs(wid)
        sendContent(wid, newPath)
        syncTitle(wid)
      }
      return { ok: true, path: newPath }
    })
    ipcMain.handle('export-pdf', async (e, opts) => {
      const id = e.sender.id
      const w = entryOf(id)
      if (!w || w.win.isDestroyed()) return { ok: false, error: 'no window' }
      try {
        const pdf = await e.sender.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        })
        let target = typeof opts?.autoPath === 'string' ? opts.autoPath : null
        if (!target) {
          const base = w.activePath ? path.basename(w.activePath).replace(/\.[^.]+$/, '') : 'document'
          const r = await dialog.showSaveDialog(w.win, {
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

    // Bring back the tabs from the previous session first, then add the file
    // passed on the command line (double-click / "open with") on top —
    // launching via a file must not discard the remembered tabs. Goes to the
    // last-focused (most recently restored) window.
    const cli = extractFileArg(process.argv)
    await restoreSession()
    if (cli) await openFile(cli)

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

function extractFileArg(argv) {
  return argv.find((a) => SUPPORTED.test(a) && !a.startsWith('-') && !a.startsWith('local-file'))
}
