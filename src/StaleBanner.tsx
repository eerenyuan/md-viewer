interface Props {
  dirty: boolean
  onReload: () => void
  onDismiss: () => void
}

/** Banner shown when the file changes on disk while a tab is open.
 *  The user decides whether to reload — nothing is clobbered silently. */
export default function StaleBanner({ dirty, onReload, onDismiss }: Props) {
  return (
    <div className="stale-banner" role="status">
      <span className="stale-banner-text">
        📄 文件已被外部程序修改
        {dirty ? '，重新加载将丢弃未保存的修改' : ''}
      </span>
      <button className="stale-banner-btn primary" onClick={onReload}>
        ↻ 重新加载{dirty ? '（丢弃修改）' : ''}
      </button>
      <button className="stale-banner-btn" onClick={onDismiss}>
        忽略
      </button>
    </div>
  )
}
