import { useCallback, useEffect, useRef, useState } from 'react'
import MarkdownView from './views/MarkdownView'
import ExcalidrawView from './views/ExcalidrawView'
import TabBar, { type TabMeta } from './TabBar'

const SUPPORTED = /\.(md|markdown|mkd|mdown|excalidraw|excalidraw\.md|excalidraw\.json)$/i

function isExcalidraw(path: string) {
  return /\.excalidraw(\.md|\.json)?$/i.test(path)
}

const THEMES = ['system', 'light', 'dark'] as const
type Theme = (typeof THEMES)[number]
const THEME_ICON: Record<Theme, string> = { system: '🖥️', light: '☀️', dark: '🌙' }
const THEME_TITLE: Record<Theme, string> = {
  system: '主题：跟随系统（点击切换）',
  light: '主题：亮色（点击切换）',
  dark: '主题：暗色（点击切换）',
}

export default function App() {
  const [tabs, setTabs] = useState<TabMeta[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [contents, setContents] = useState<Record<string, string>>({})
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({})
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const renamingPathRef = useRef<string | null>(null)
  renamingPathRef.current = renamingPath
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'system'
  })

  const contentCache = useRef(new Map<string, string>())
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activePath
  const dirtyMapRef = useRef<Record<string, boolean>>({})
  dirtyMapRef.current = dirtyMap
  const tabsRef = useRef<TabMeta[]>(tabs)
  tabsRef.current = tabs
  const activeDirty = !!activePath && !!dirtyMap[activePath]
  const activeDirtyRef = useRef(false)
  activeDirtyRef.current = activeDirty

  const startRename = useCallback((p: string) => {
    if (p === activePathRef.current && dirtyMapRef.current[p]) {
      window.alert('有未保存的修改，请先保存后再重命名')
      return
    }
    setRenamingPath(p)
  }, [])

  const handleRename = useCallback(async (p: string, name: string) => {
    setRenamingPath(null)
    const clean = name.trim()
    if (!clean) return
    const r = await window.viewer.renameFile(p, clean)
    if (!r.ok) window.alert('重命名失败：' + (r.error ?? '未知错误'))
    else setDirtyMap((m) => {
      if (!(p in m)) return m
      const next = { ...m }
      next[r.path ?? p] = next[p] ?? false
      delete next[p]
      return next
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('theme', theme)
    window.viewer.setThemeSource(theme)
  }, [theme])

  // keep every tab's content in state — all panes stay mounted (keep-alive),
  // so scroll position, edit buffers and find/TOC state survive tab switches
  const ensureContents = useCallback(async (paths: string[]) => {
    const missing = paths.filter((p) => !contentCache.current.has(p))
    if (missing.length === 0) return
    const entries = await Promise.all(
      missing.map(async (p) => [p, await window.viewer.getTabContent(p)] as const),
    )
    const got = entries.filter(([, c]) => c != null) as [string, string][]
    for (const [p, c] of got) contentCache.current.set(p, c)
    if (got.length) {
      setContents((prev) => {
        const next = { ...prev }
        for (const [p, c] of got) next[p] = c
        return next
      })
    }
  }, [])

  useEffect(() => {
    const applyTabs = (data: { tabs: TabMeta[]; activePath: string | null }) => {
      const valid = new Set(data.tabs.map((t) => t.path))
      for (const k of contentCache.current.keys()) {
        if (!valid.has(k)) contentCache.current.delete(k)
      }
      setTabs(data.tabs)
      setActivePath(data.activePath)
      void ensureContents(data.tabs.map((t) => t.path))
    }

    const offTabs = window.viewer.onTabsChanged(applyTabs)
    const offContent = window.viewer.onContentUpdated(({ path, content }) => {
      contentCache.current.set(path, content)
      setContents((prev) => ({ ...prev, [path]: content }))
    })
    const offFileChanged = window.viewer.onFileChanged(({ path }) => {
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, stale: true } : t)))
    })
    window.viewer.getState().then(applyTabs)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        const p = activePathRef.current
        if (p && !renamingPathRef.current) {
          e.preventDefault()
          startRename(p)
        }
        return
      }
      if (!e.ctrlKey) return
      if (e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void window.viewer.openNewWindow()
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const paths = tabsRef.current.map((t) => t.path)
        if (paths.length < 2) return
        const idx = paths.indexOf(activePathRef.current ?? '')
        const next = paths[(idx + (e.shiftKey ? paths.length - 1 : 1)) % paths.length]
        window.viewer.activateTab(next)
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (activePathRef.current) window.viewer.closeTab(activePathRef.current)
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      offTabs()
      offContent()
      offFileChanged()
      window.removeEventListener('keydown', onKey)
    }
  }, [ensureContents, startRename])

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (!f) return
    const p = window.viewer.pathForFile(f)
    if (SUPPORTED.test(p)) await window.viewer.openPath(p)
  }

  return (
    <div
      className="app-root"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activePath={activePath}
          renamingPath={renamingPath}
          onSelect={(p) => window.viewer.activateTab(p)}
          onClose={(p) => window.viewer.closeTab(p)}
          onStartRename={startRename}
          onRename={(p, name) => void handleRename(p, name)}
          onCancelRename={() => setRenamingPath(null)}
          onTearOut={(p, sx, sy) => void window.viewer.tabDragEnd(p, sx, sy)}
        />
      )}
      <button
        className="theme-toggle"
        title={THEME_TITLE[theme]}
        onClick={() =>
          setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])
        }
      >
        {THEME_ICON[theme]}
      </button>
      {tabs.map((t) => {
        const content = contents[t.path] ?? ''
        return (
          <div key={t.path} className={`tab-pane ${t.path === activePath ? 'active' : 'keep'}`}>
            {isExcalidraw(t.path) ? (
              <ExcalidrawView
                content={content}
                fileName={t.path}
                stale={t.stale ?? false}
                active={t.path === activePath}
                onReload={() => void window.viewer.reloadTab(t.path)}
                onDismiss={() => void window.viewer.dismissFileChanged(t.path)}
                onDirtyChange={(d) =>
                  setDirtyMap((m) => (m[t.path] === d ? m : { ...m, [t.path]: d }))
                }
              />
            ) : (
              <MarkdownView
                content={content}
                filePath={t.path}
                stale={t.stale ?? false}
                active={t.path === activePath}
                onReload={() => void window.viewer.reloadTab(t.path)}
                onDismiss={() => void window.viewer.dismissFileChanged(t.path)}
                onDirtyChange={(d) =>
                  setDirtyMap((m) => (m[t.path] === d ? m : { ...m, [t.path]: d }))
                }
              />
            )}
          </div>
        )
      })}
      {!activePath && (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <p>
            双击任意 <code>.md</code> / <code>.excalidraw</code> 文件，
            <br />
            或把它拖到这个窗口
          </p>
        </div>
      )}
    </div>
  )
}
