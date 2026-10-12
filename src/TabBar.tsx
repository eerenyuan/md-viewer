import { useEffect, useRef, useState } from 'react'

export interface TabMeta {
  path: string
  stale?: boolean
}

interface Props {
  tabs: TabMeta[]
  activePath: string | null
  renamingPath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onStartRename: (path: string) => void
  onRename: (path: string, newName: string) => void
  onCancelRename: () => void
  onTearOut: (path: string) => void
}

function baseName(p: string) {
  const parts = p.replace(/\\/g, '/')
  return parts.slice(parts.lastIndexOf('/') + 1) || p
}

function RenameInput({
  path,
  onRename,
  onCancel,
}: {
  path: string
  onRename: (path: string, name: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    const el = ref.current
    // Esc marks cancelled first — the unmount blur must not re-commit;
    // Enter/blur marks done so the async rename can't be fired twice
    if (!el || el.dataset.cancelled || el.dataset.done) return
    el.dataset.done = '1'
    const name = el.value.trim()
    if (!name || name === baseName(path)) onCancel()
    else onRename(path, name)
  }

  return (
    <input
      ref={ref}
      className="tab-rename"
      defaultValue={baseName(path)}
      spellCheck={false}
      title="Enter 确认 · Esc 取消"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          if (ref.current) ref.current.dataset.cancelled = '1'
          onCancel()
        }
      }}
    />
  )
}

export default function TabBar({
  tabs,
  activePath,
  renamingPath,
  onSelect,
  onClose,
  onStartRename,
  onRename,
  onCancelRename,
  onTearOut,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ path: string; x: number; y: number; tearing: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null)

  // tear-off: dragging a tab below/above the tab bar detaches it into a new
  // window (browser-style). Plain clicks and double-click-rename still work —
  // the drag only arms once the pointer clearly left the bar.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const bar = barRef.current?.getBoundingClientRect()
      if (!bar) return
      if (!d.tearing) {
        const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y)
        const outside = e.clientY > bar.bottom + 12 || e.clientY < bar.top - 12
        if (dist < 8 || !outside) return
        d.tearing = true
        suppressClickRef.current = true
        document.body.classList.add('tab-tearing')
      }
      setGhost({ x: e.clientX, y: e.clientY, name: baseName(d.path) })
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      setGhost(null)
      document.body.classList.remove('tab-tearing')
      if (d?.tearing) onTearOut(d.path)
      // let the (suppressed) synthetic click fire first, then re-arm
      setTimeout(() => (suppressClickRef.current = false), 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [onTearOut])

  return (
    <div className="tab-bar" ref={barRef}>
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab ${t.path === activePath ? 'active' : ''}`}
          title={renamingPath === t.path ? 'Enter 确认 · Esc 取消' : `${t.path}\n双击或 F2 重命名 · 拖出标签页可拆分为新窗口`}
          onClick={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            onSelect(t.path)
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            const target = e.target as HTMLElement
            if (target.closest('.tab-close') || target.closest('.tab-rename')) return
            dragRef.current = { path: t.path, x: e.clientX, y: e.clientY, tearing: false }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartRename(t.path)
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(t.path)
          }}
        >
          <span className={`tab-icon ${/\.excalidraw(\.md|\.json)?$/i.test(t.path) ? 'excal' : 'md'}`}>
            {/\.excalidraw(\.md|\.json)?$/i.test(t.path) ? '◈' : 'M'}
          </span>
          {renamingPath === t.path ? (
            <RenameInput path={t.path} onRename={onRename} onCancel={onCancelRename} />
          ) : (
            <span className="tab-name">{baseName(t.path)}</span>
          )}
          {t.stale && <span className="tab-stale" title="文件已被外部修改">↻</span>}
          <button
            className="tab-close"
            title="关闭 (Ctrl+W)"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.path)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ×
          </button>
        </div>
      ))}
      {ghost && (
        <div className="tab-tear-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.name}
        </div>
      )}
    </div>
  )
}
