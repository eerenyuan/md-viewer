import { useEffect, useRef } from 'react'

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
}: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab ${t.path === activePath ? 'active' : ''}`}
          title={renamingPath === t.path ? 'Enter 确认 · Esc 取消' : `${t.path}\n双击或 F2 重命名`}
          onClick={() => onSelect(t.path)}
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
    </div>
  )
}
