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
  const [activeContent, setActiveContent] = useState('')
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'system'
  })

  const contentCache = useRef(new Map<string, string>())
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activePath
  const tabsRef = useRef<TabMeta[]>(tabs)
  tabsRef.current = tabs
  const activeTab = tabs.find((t) => t.path === activePath)

  useEffect(() => {
    localStorage.setItem('theme', theme)
    window.viewer.setThemeSource(theme)
  }, [theme])

  const ensureContent = useCallback(async (p: string | null) => {
    if (!p) {
      setActiveContent('')
      return
    }
    const cached = contentCache.current.get(p)
    if (cached !== undefined) {
      setActiveContent(cached)
      return
    }
    const c = await window.viewer.getTabContent(p)
    if (c != null) {
      contentCache.current.set(p, c)
      if (activePathRef.current === p) setActiveContent(c)
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
      void ensureContent(data.activePath)
    }

    const offTabs = window.viewer.onTabsChanged(applyTabs)
    const offContent = window.viewer.onContentUpdated(({ path, content }) => {
      contentCache.current.set(path, content)
      if (activePathRef.current === path) setActiveContent(content)
    })
    const offFileChanged = window.viewer.onFileChanged(({ path }) => {
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, stale: true } : t)))
    })
    window.viewer.getState().then(applyTabs)

    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
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
  }, [ensureContent])

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
          onSelect={(p) => window.viewer.activateTab(p)}
          onClose={(p) => window.viewer.closeTab(p)}
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
      {!activePath ? (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <p>
            双击任意 <code>.md</code> / <code>.excalidraw</code> 文件，
            <br />
            或把它拖到这个窗口
          </p>
        </div>
      ) : isExcalidraw(activePath) ? (
        <ExcalidrawView
          key={activePath}
          content={activeContent}
          fileName={activePath}
          stale={activeTab?.stale ?? false}
          onReload={() => void window.viewer.reloadTab(activePath)}
          onDismiss={() => void window.viewer.dismissFileChanged(activePath)}
        />
      ) : (
        <MarkdownView
          key={activePath}
          content={activeContent}
          filePath={activePath}
          stale={activeTab?.stale ?? false}
          onReload={() => void window.viewer.reloadTab(activePath)}
          onDismiss={() => void window.viewer.dismissFileChanged(activePath)}
        />
      )}
    </div>
  )
}
