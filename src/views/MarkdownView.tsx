import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import LiveEditor from './LiveEditor'
import { renderMarkdown, toLocalFileUrl, isExcalidrawRef } from '../lib/markdown'
import { parseExcalidraw } from '../lib/excalidraw'
import { renderMermaid } from '../lib/mermaid'
import { exportToSvg } from '@excalidraw/excalidraw'
import TocPanel, { type TocHeading } from '../TocPanel'
import StaleBanner from '../StaleBanner'
import FindBar from '../FindBar'

interface Props {
  content: string
  filePath: string
  stale: boolean
  onReload: () => void
  onDismiss: () => void
}

/** Map the current view-mode scroll position to a source offset for the
 *  editor: anchor on the last heading scrolled past (occurrence-aligned with
 *  the source heading lines), fall back to scroll fraction. */
function computeEditorAnchor(content: string): number {
  const scroll = document.querySelector('.md-scroll') as HTMLElement | null
  const body = scroll?.querySelector('.markdown-body') as HTMLElement | null
  if (!scroll || !body) return 0
  const viewportTop = scroll.getBoundingClientRect().top
  const heads = [...body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
  let target: HTMLElement | null = null
  for (const h of heads) {
    if (h.getBoundingClientRect().bottom <= viewportTop + 4) target = h
    else break
  }
  if (target?.textContent) {
    const text = target.textContent.replace(/\s+/g, '')
    let occurrence = 0
    for (const h of heads) {
      if (h === target) break
      if (h.textContent?.replace(/\s+/g, '') === text) occurrence++
    }
    let off = 0
    let seen = 0
    for (const line of content.split('\n')) {
      const m = /^#{1,6}[ \t]+(.*)/.exec(line)
      if (m && m[1].replace(/\s+/g, '') === text) {
        if (seen === occurrence) return off + line.indexOf(m[1])
        seen++
      }
      off += line.length + 1
    }
  }
  const sh = scroll.scrollHeight - scroll.clientHeight
  const frac = sh > 0 ? Math.min(1, Math.max(0, scroll.scrollTop / sh)) : 0
  return Math.round(frac * content.length)
}

/** Resolve and inline-render every Excalidraw embed in the rendered container. */
async function renderEmbeds(container: HTMLElement, dirSlash: string) {
  interface Pending {
    node: Element
    ref: string
    width?: string
  }
  const pending: Pending[] = []

  container.querySelectorAll<HTMLElement>('.excalidraw-embed[data-ref]').forEach((el) => {
    pending.push({
      node: el,
      ref: decodeURIComponent(el.dataset.ref ?? ''),
      width: el.dataset.width,
    })
  })

  container.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (isExcalidrawRef(src)) {
      pending.push({ node: img, ref: src, width: undefined })
    }
  })

  for (const item of pending) {
    if (!item.node.isConnected) continue
    const host = document.createElement('div')
    host.className = 'excalidraw-embed-box'
    if (item.width) host.style.maxWidth = `${item.width}px`
    item.node.replaceWith(host)

    const fail = (msg: string) => {
      const box = document.createElement('div')
      box.className = 'embed-error'
      box.textContent = msg
      host.replaceChildren(box)
    }

    const absPath = await window.viewer.resolveEmbed(dirSlash, item.ref)
    if (!absPath) {
      fail(`⚠ 未找到 Excalidraw 文件：${item.ref}`)
      continue
    }
    const r = await window.viewer.readEmbed(absPath)
    if (!r.ok) {
      fail(`⚠ 读取失败：${item.ref}`)
      continue
    }
    try {
      const scene = parseExcalidraw(r.content ?? '')
      const svg = await exportToSvg({
        elements: scene.elements as never,
        appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff' },
        files: {},
      })
      if (!host.isConnected) continue
      svg.style.maxWidth = '100%'
      svg.style.height = 'auto'
      host.replaceChildren(svg)
    } catch (e) {
      fail(`⚠ Excalidraw 渲染失败：${(e as Error).message}`)
    }
  }
}

/** Replace ```mermaid code blocks with rendered diagrams. */
async function renderMermaidBlocks(container: HTMLElement) {
  const blocks = [...container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]
  for (const code of blocks) {
    if (!code.isConnected) continue
    const pre = code.parentElement!
    const source = code.textContent ?? ''
    const box = document.createElement('div')
    box.className = 'mermaid-box'
    pre.replaceWith(box)
    try {
      const svg = await renderMermaid(source)
      if (box.isConnected) box.innerHTML = svg
    } catch (e) {
      if (!box.isConnected) continue
      box.className = 'embed-error'
      box.textContent = `⚠ Mermaid 渲染失败：${(e as Error).message}`
    }
  }
}

/** The read-only rendered document. */
function RenderedDoc({
  content,
  dirSlash,
  onToc,
  bodyRef,
  zoom,
}: {
  content: string
  dirSlash: string
  onToc: (headings: TocHeading[]) => void
  bodyRef: React.RefObject<HTMLDivElement | null>
  zoom: number
}) {
  const html = useMemo(() => renderMarkdown(content), [content])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = html

    el.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || ''
      if (!src || isExcalidrawRef(src)) return
      if (/^(https?:|data:|local-file:)/.test(src)) return
      img.src = toLocalFileUrl(dirSlash, src)
    })

    // external links -> system browser; anchor links -> smooth scroll
    el.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || ''
      if (/^https?:/i.test(href)) {
        a.target = '_blank'
        a.rel = 'noreferrer noopener'
      } else if (href.startsWith('#')) {
        a.addEventListener('click', (e) => {
          e.preventDefault()
          let frag = href.slice(1)
          try {
            frag = decodeURIComponent(frag)
          } catch {
            /* keep raw */
          }
          const target = document.getElementById(frag)
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    })

    void renderMermaidBlocks(el)
    void renderEmbeds(el, dirSlash)

    const headings: TocHeading[] = [...el.querySelectorAll<HTMLElement>('h1, h2, h3')]
      .filter((h) => h.id)
      .map((h) => ({ id: h.id, text: h.textContent ?? '', level: Number(h.tagName[1]) }))
    onToc(headings)
  }, [html, dirSlash])
  return (
    <div className="md-scroll" style={{ zoom }}>
      <div ref={bodyRef} className="markdown-body" />
    </div>
  )
}

export default function MarkdownView({ content, filePath, stale, onReload, onDismiss }: Props) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [editorAnchor, setEditorAnchor] = useState(0)
  const [zoom, setZoom] = useState(() => {
    const saved = Number(localStorage.getItem('zoom'))
    return Number.isFinite(saved) && saved >= 0.5 && saved <= 2.5 ? saved : 1
  })
  const docRef = useRef<HTMLDivElement>(null)
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [toc, setToc] = useState<TocHeading[]>([])
  const [tocVisible, setTocVisible] = useState(() => {
    const saved = localStorage.getItem('toc')
    if (saved === '0') return false
    if (saved === '1') return true
    return window.innerWidth > 1300
  })
  const cmRef = useRef<EditorView | null>(null)
  const savedRef = useRef(content)

  const dirSlash = useMemo(() => {
    const idx = filePath.replace(/\\/g, '/').lastIndexOf('/')
    return idx >= 0 ? filePath.replace(/\\/g, '/').slice(0, idx) : ''
  }, [filePath])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    localStorage.setItem('toc', tocVisible ? '1' : '0')
  }, [tocVisible])

  useEffect(() => {
    localStorage.setItem('zoom', String(zoom))
  }, [zoom])

  // Ctrl+wheel adjusts document zoom (50%–250%), Ctrl+0 resets
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => {
        const next = z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)
        return Math.min(2.5, Math.max(0.5, Math.round(next * 100) / 100))
      })
    }
    const onZoomKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        setZoom(1)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onZoomKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onZoomKey)
    }
  }, [])

  const enterEditMode = () => {
    savedRef.current = content
    setConfirmDiscard(false)
    setDirty(false)
    setFindOpen(false)
    setEditorAnchor(computeEditorAnchor(content))
    setMode('edit')
  }

  const save = async () => {
    const view = cmRef.current
    if (!view) return
    const text = view.state.doc.toString()
    const r = await window.viewer.saveFile(filePath, text)
    if (r.ok) {
      savedRef.current = text
      setDirty(false)
    } else {
      window.alert('保存失败：' + (r.error ?? '未知错误'))
    }
  }

  const exitEditMode = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      setTimeout(() => setConfirmDiscard(false), 3000)
      return
    }
    setDirty(false)
    setConfirmDiscard(false)
    setMode('view')
  }

  const exportPdf = async () => {
    if (mode !== 'view') return
    const r = await window.viewer.exportPdf()
    if (!r.ok && !r.canceled) window.alert('导出失败：' + (r.error ?? '未知错误'))
  }

  const handleStaleReload = () => {
    if (mode === 'edit') {
      // the editor keeps showing the old buffer while dirty; a reload while
      // dirty means dropping it and falling back to the (fresh) view mode
      setDirty(false)
      setConfirmDiscard(false)
      setMode('view')
    }
    onReload()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.defaultPrevented) return
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        if (mode === 'view') enterEditMode()
        else exitEditMode()
      } else if (e.key.toLowerCase() === 's' && mode === 'edit') {
        e.preventDefault()
        void save()
      } else if (e.key.toLowerCase() === 'p' && mode === 'view') {
        e.preventDefault()
        void exportPdf()
      } else if (e.key.toLowerCase() === 'f' && mode === 'view') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // when clean, follow external content changes; when dirty, protect the buffer
  const editorContent = dirty ? savedRef.current : content

  // re-rendered content invalidates live find ranges — close the bar
  useEffect(() => {
    setFindOpen(false)
  }, [content])

  return (
    <>
      <div className="viewer-toolbar">
        {mode === 'view' ? (
          <>
            <button title="导出 PDF (Ctrl+P)" onClick={exportPdf}>
              🖨 PDF
            </button>
            <button
              title={tocVisible ? '隐藏目录' : '显示目录'}
              onClick={() => setTocVisible((v) => !v)}
            >
              📑 {tocVisible ? '收起目录' : '目录'}
            </button>
            <button title="编辑 (Ctrl+E)" onClick={enterEditMode}>
              ✏️ 编辑
            </button>
          </>
        ) : (
          <>
            <button title={dirty ? '保存 (Ctrl+S)' : '已保存'} onClick={save} disabled={!dirty}>
              💾 {dirty ? '保存*' : '已保存'}
            </button>
            <button
              title={confirmDiscard ? '再点一次确认丢弃' : '切回查看 (Ctrl+E)'}
              className={confirmDiscard ? 'danger' : ''}
              onClick={exitEditMode}
            >
              {confirmDiscard ? '⚠️ 确认丢弃' : '👁 查看'}
            </button>
          </>
        )}
      </div>
      {stale && <StaleBanner dirty={mode === 'edit' && dirty} onReload={handleStaleReload} onDismiss={onDismiss} />}
      {mode === 'view' && findOpen && (
        <FindBar
          containerRef={docRef}
          html={content}
          topOffset={stale ? 46 : 0}
          onClose={() => setFindOpen(false)}
        />
      )}
      {mode === 'view' && tocVisible && <TocPanel headings={toc} />}
      {mode === 'edit' ? (
        <LiveEditor
          content={editorContent}
          dirSlash={dirSlash}
          dark={dark}
          onDirtyChange={setDirty}
          viewRef={cmRef}
          initialPos={editorAnchor}
          zoom={zoom}
        />
      ) : (
        <RenderedDoc content={content} dirSlash={dirSlash} onToc={setToc} bodyRef={docRef} zoom={zoom} />
      )}
    </>
  )
}
