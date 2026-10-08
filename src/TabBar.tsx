export interface TabMeta {
  path: string
  stale?: boolean
}

interface Props {
  tabs: TabMeta[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

function baseName(p: string) {
  const parts = p.replace(/\\/g, '/')
  return parts.slice(parts.lastIndexOf('/') + 1) || p
}

export default function TabBar({ tabs, activePath, onSelect, onClose }: Props) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.path}
          className={`tab ${t.path === activePath ? 'active' : ''}`}
          title={t.path}
          onClick={() => onSelect(t.path)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(t.path)
          }}
        >
          <span className={`tab-icon ${/\.excalidraw(\.md|\.json)?$/i.test(t.path) ? 'excal' : 'md'}`}>
            {/\.excalidraw(\.md|\.json)?$/i.test(t.path) ? '◈' : 'M'}
          </span>
          <span className="tab-name">{baseName(t.path)}</span>
          {t.stale && <span className="tab-stale" title="文件已被外部修改">↻</span>}
          <button
            className="tab-close"
            title="关闭 (Ctrl+W)"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.path)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
