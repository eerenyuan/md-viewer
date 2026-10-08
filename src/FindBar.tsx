import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  /** element that holds the rendered document (searched node) */
  containerRef: React.RefObject<HTMLElement | null>
  /** rendered html identity — invalidate matches when it changes */
  html: string
  /** extra top offset when another banner occupies the slot */
  topOffset?: number
  onClose: () => void
}

interface MatchRange {
  range: Range
}

/** Collect all text nodes under root, flattened into one string with offsets. */
function collectText(root: HTMLElement) {
  const parts: { node: Text; start: number; end: number }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cursor = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    parts.push({ node: t, start: cursor, end: cursor + t.data.length })
    cursor += t.data.length
  }
  return { parts, full: parts.map((p) => p.node.data).join('') }
}

function locateRange(parts: { node: Text; start: number }[], absStart: number, absEnd: number) {
  // binary search for the node containing absStart
  let lo = 0
  let hi = parts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (parts[mid].start <= absStart) lo = mid
    else hi = mid - 1
  }
  const first = parts[lo]
  if (!first) return null
  const range = document.createRange()
  range.setStart(first.node, absStart - first.start)
  // walk forward to the node containing absEnd (match may span several nodes)
  let cur = lo
  while (cur + 1 < parts.length && parts[cur + 1].start < absEnd) cur++
  const last = parts[cur]
  range.setEnd(last.node, absEnd - last.start)
  return range
}

/** Ctrl+F find bar for the rendered (view-mode) document.
 *  Uses the CSS Custom Highlight API — no DOM mutation, so existing anchors,
 *  TOC references and event listeners survive. */
export default function FindBar({ containerRef, html, topOffset = 0, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const matches = useMemo<MatchRange[]>(() => {
    const root = containerRef.current
    if (!root || !query) return []
    const { parts, full } = collectText(root)
    const hay = full.toLowerCase()
    const needle = query.toLowerCase()
    const out: MatchRange[] = []
    let from = 0
    for (;;) {
      const idx = hay.indexOf(needle, from)
      if (idx === -1 || !needle) break
      const range = locateRange(parts, idx, idx + needle.length)
      if (range) out.push({ range })
      from = idx + Math.max(1, needle.length)
    }
    return out
    // recompute on query and on re-rendered html identity
  }, [query, html, containerRef])

  // paint highlights
  useEffect(() => {
    const hl = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
    if (!hl) return
    hl.delete('md-find')
    hl.delete('md-find-current')
    if (matches.length) {
      const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
        .Highlight
      if (!HighlightCtor) return
      hl.set('md-find', new HighlightCtor(...matches.map((m) => m.range)))
      if (matches[current]) {
        hl.set('md-find-current', new HighlightCtor(matches[current].range))
      }
    }
  }, [matches, current])

  // keep current in range, scroll it into view
  useEffect(() => {
    const m = matches[current]
    if (!m) return
    const el =
      m.range.startContainer instanceof Element
        ? m.range.startContainer
        : m.range.startContainer.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [matches, current])

  // cleanup on unmount
  useEffect(() => {
    const hl = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
    return () => {
      hl?.delete('md-find')
      hl?.delete('md-find-current')
    }
  }, [])

  const step = (dir: 1 | -1) => {
    if (!matches.length) return
    setCurrent((c) => (c + dir + matches.length) % matches.length)
  }

  return (
    <div className="find-bar" style={topOffset ? { top: `${46 + topOffset}px` } : undefined}>
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="查找…"
        onChange={(e) => {
          setQuery(e.target.value)
          setCurrent(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="find-count">
        {matches.length ? `${current + 1}/${matches.length}` : query ? '无结果' : ''}
      </span>
      <button className="find-btn" title="上一个 (Shift+Enter)" onClick={() => step(-1)} disabled={!matches.length}>
        ↑
      </button>
      <button className="find-btn" title="下一个 (Enter)" onClick={() => step(1)} disabled={!matches.length}>
        ↓
      </button>
      <button className="find-btn" title="关闭 (Esc)" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
