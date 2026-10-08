import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  keymap,
} from '@codemirror/view'
import { StateField, type Range, type EditorState, Prec } from '@codemirror/state'
import { Text } from '@codemirror/state'
import hljs from 'highlight.js'
import { renderMarkdown, renderInline, toLocalFileUrl } from './markdown'
import { renderMermaid } from './mermaid'

interface Block {
  from: number
  to: number // exclusive of trailing newline
  lineFrom: number // 1-based
  lineTo: number
  kind: 'heading' | 'fence' | 'para' | 'frontmatter'
  text: string
}

/**
 * Split the document into top-level blocks:
 * front matter / ATX heading / fenced code / paragraph-ish run of lines.
 */
function analyzeBlocks(doc: Text): Block[] {
  const blocks: Block[] = []
  const n = doc.lines
  let i = 1

  // front matter
  if (n >= 1 && doc.line(1).text.trim() === '---') {
    let j = 2
    while (j <= n && doc.line(j).text.trim() !== '---') j++
    if (j <= n) {
      const first = doc.line(1)
      const last = doc.line(j)
      blocks.push({
        from: first.from,
        to: last.to,
        lineFrom: 1,
        lineTo: j,
        kind: 'frontmatter',
        text: '',
      })
      i = j + 1
    }
  }

  while (i <= n) {
    const line = doc.line(i)
    const t = line.text
    if (!t.trim()) {
      i++
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(t)
    if (heading) {
      blocks.push({ from: line.from, to: line.to, lineFrom: i, lineTo: i, kind: 'heading', text: t })
      i++
      continue
    }
    const fenceChar = (/^\s*(```|~~~)/.exec(t) ?? [])[1]?.[0]
    if (fenceChar) {
      const start = i
      const closeRe = new RegExp(`^\\s*\\${fenceChar}{3,}\\s*$`)
      i++
      while (i <= n && !closeRe.test(doc.line(i).text)) i++
      if (i <= n) i++ // include closing fence
      const lineTo = Math.min(i - 1, n)
      const from = doc.line(start).from
      const to = doc.line(lineTo).to
      blocks.push({ from, to, lineFrom: start, lineTo, kind: 'fence', text: doc.sliceString(from, to) })
      continue
    }
    const start = i
    while (i <= n && doc.line(i).text.trim()) i++
    const lineTo = i - 1
    const from = doc.line(start).from
    const to = doc.line(lineTo).to
    blocks.push({ from, to, lineFrom: start, lineTo, kind: 'para', text: doc.sliceString(from, to) })
  }
  return blocks
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Render a block's source into display HTML for the widget. */
function renderBlockHtml(block: Block): string {
  if (block.kind === 'heading') {
    const m = /^(#{1,6})\s+(.*)$/.exec(block.text)!
    const level = m[1].length
    return `<h${level}>${renderInline(m[2])}</h${level}>`
  }
  if (block.kind === 'fence') {
    const lines = block.text.split('\n')
    const open = /^```\s*(\S*)/.exec(lines[0])
    const lang = open?.[1] ?? ''
    const closing =
      lines.length > 1 && /^\s*(```|~~~)\s*$/.test(lines[lines.length - 1])
    const body = lines.slice(1, closing ? -1 : undefined).join('\n')

    // mermaid diagrams render async in the widget's toDOM; the html here is a
    // placeholder carrying the encoded source
    if (lang === 'mermaid') {
      return `<div class="mermaid-pending" data-src="${encodeURIComponent(body)}"></div>`
    }

    let code: string
    if (lang && hljs.getLanguage(lang)) {
      try {
        code = hljs.highlight(body, { language: lang, ignoreIllegals: true }).value
      } catch {
        code = escapeHtml(body)
      }
    } else {
      code = escapeHtml(body)
    }
    return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${code}</code></pre>`
  }
  return renderMarkdown(block.text)
}

/** Resolve relative img srcs inside a widget container against the md file dir. */
function fixWidgetImages(el: HTMLElement, dirSlash: string) {
  el.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!src || /^(https?:|data:|local-file:)/.test(src)) return
    img.src = toLocalFileUrl(dirSlash, src)
  })
}

class BlockWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly blockStart: number,
    readonly dirSlash: string,
    readonly blockText: string,
  ) {
    super()
  }
  eq(other: BlockWidget) {
    return other.html === this.html && other.blockStart === this.blockStart
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-widget'
    wrap.innerHTML = this.html
    fixWidgetImages(wrap, this.dirSlash)

    // mermaid placeholders fill in asynchronously once rendered
    const pending = wrap.querySelector<HTMLElement>('.mermaid-pending')
    if (pending) {
      const src = decodeURIComponent(pending.dataset.src ?? '')
      renderMermaid(src)
        .then((svg) => {
          if (wrap.isConnected) pending.outerHTML = svg
        })
        .catch((e) => {
          if (!wrap.isConnected) return
          pending.className = 'embed-error'
          pending.textContent = `⚠ Mermaid 渲染失败：${(e as Error).message}`
        })
    }

    // clicking a rendered block puts the caret at the clicked character in its source
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // our dispatch collapses this widget synchronously; if the event kept
      // bubbling, CM6's own mousedown handler would re-map the (stale) click
      // coords against the new layout and yank the caret away
      e.stopPropagation()
      // both blocks flip render/source form and the document height changes
      // wildly — re-anchor the viewport on the caret, centered for visibility
      // ("nearest" tends to park the caret at the screen edge)
      const pos = this.posFromClick(view, e)
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
    })
    return wrap
  }
  ignoreEvent() {
    return false
  }
  /** Map the click point to a source offset: caretRangeFromPoint gives the
   *  offset inside the rendered DOM; flatten-match it back over the block's
   *  source (markup chars are skipped as noise). */
  posFromClick(view: EditorView, e: MouseEvent): number {
    const host = (e.currentTarget as HTMLElement) ?? null
    const range = document.caretRangeFromPoint(e.clientX, e.clientY)
    if (!host || !range || !host.contains(range.startContainer)) return this.blockStart
    const pre = document.createRange()
    pre.selectNodeContents(host)
    try {
      pre.setEnd(range.startContainer, range.startOffset)
    } catch {
      return this.blockStart
    }
    const rendered = pre.toString().replace(/\s+/g, '')
    if (!rendered) return this.blockStart
    const src = this.blockText
    let i = 0
    let j = 0
    for (; i < src.length && j < rendered.length; i++) {
      const ch = src[i]
      if (/\s/.test(ch)) continue
      if (ch === rendered[j]) {
        j++
        continue
      }
      // markup-ish source char with no rendered counterpart: skip it
      if (/[#*_`~[\]()>|!+=."']/.test(ch)) continue
      // unexpected mismatch: skip (best effort — stay near the click)
    }
    return Math.min(this.blockStart + i, view.state.doc.length)
  }
}

function buildDecorations(state: EditorState, dirSlash: string, cache: Map<string, string>): DecorationSet {
  const sel = state.selection.main.head
  const doc = state.doc
  const ranges: Range<Decoration>[] = []

  const blockHtml = (b: Block): string => {
    let html = cache.get(b.text)
    if (html === undefined) {
      html = renderBlockHtml(b)
      if (cache.size > 500) cache.clear()
      cache.set(b.text, html)
    }
    return html
  }

  const blocks = analyzeBlocks(doc)
  const active = blocks.find((b) => sel >= b.from && sel <= b.to + 1)

  // the active (source-form) block gets a soft background so the user can
  // spot where they landed after a cross-block jump
  if (active) {
    for (let i = active.lineFrom; i <= active.lineTo; i++) {
      const line = doc.line(i)
      ranges.push(Decoration.line({ class: 'cm-active-block' }).range(line.from))
    }
  }

  for (const b of blocks) {
    if (b.kind === 'frontmatter') continue // keep front matter as plain source
    if (b === active) continue
    const endLine = doc.line(b.lineTo)
    const to = Math.min(endLine.to + 1, doc.length) // swallow the trailing newline
    ranges.push(
      Decoration.replace({
        widget: new BlockWidget(blockHtml(b), b.from, dirSlash, b.text),
        block: true,
        side: 1,
      }).range(b.from, to),
    )
  }

  // collapse blank lines away from the active block (tight, Obsidian-like spacing)
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    if (line.text.trim()) continue
    if (active && i >= active.lineFrom - 1 && i <= active.lineTo + 1) continue
    // keep blank lines around front matter visible
    if (blocks[0]?.kind === 'frontmatter' && i <= blocks[0].lineTo + 2) continue
    const to = Math.min(line.to + 1, doc.length)
    if (to > line.from) ranges.push(Decoration.replace({}).range(line.from, to))
  }

  return Decoration.set(ranges, true)
}

/**
 * Vertical motion that is aware of rendered blocks: moving up/down across a
 * block boundary lands on the visually-adjacent end of the target block
 * (from below -> the block's last line; from above -> its first line), so the
 * caret keeps visual continuity instead of always jumping to the block head.
 */
function blockAwareVerticalMotion(view: EditorView, dir: -1 | 1): boolean {
  const sel = view.state.selection.main.head
  const blocks = analyzeBlocks(view.state.doc)
  const idx = blocks.findIndex((b) => sel >= b.from && sel <= b.to + 1)
  if (idx === -1) return false
  const active = blocks[idx]
  const doc = view.state.doc
  const line = doc.lineAt(sel)
  const col = sel - line.from

  // in-block multi-line motion: move between the block's source lines,
  // keeping the column (native moveByLine misbehaves around atomic ranges)
  const targetLineNo = dir === -1 ? line.number - 1 : line.number + 1
  if (targetLineNo >= active.lineFrom && targetLineNo <= active.lineTo) {
    const t = doc.line(targetLineNo)
    view.dispatch({ selection: { anchor: t.from + Math.min(col, t.to - t.from) }, scrollIntoView: true })
    return true
  }

  // crossing a block boundary: land on the visually-adjacent end of the
  // target block (from below -> last line; from above -> first line)
  const target = blocks[idx + dir]
  if (!target || target.kind === 'frontmatter') return false
  const pos = dir === -1 ? target.to : target.from
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  })
  // the first dispatch lands while the target's widget range is still atomic,
  // which pushes the caret to a block boundary; once the widget has collapsed
  // (block became active) a second dispatch sticks at the exact position
  view.dispatch({ selection: { anchor: pos } })
  return true
}

/**
 * Caret mapping for mouse clicks: CM6's precise posAtCoords is unreliable
 * around collapsed block widgets (returns null, or a line-end position via
 * its loose fallback). Locate the line by binary search over y, then the
 * offset by x — monotonic in visual coordinates, so it stays correct.
 */
function posFromPointMapped(view: EditorView, x: number, y: number): number | null {
  const doc = view.state.doc
  let lo = 1
  let hi = doc.lines
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const c = view.coordsAtPos(doc.line(mid).from)
    if (c && c.top <= y) lo = mid
    else hi = mid - 1
  }
  const line = doc.line(lo)
  let a = 0
  let b = line.to - line.from
  while (a < b) {
    const mid = (a + b + 1) >> 1
    const c = view.coordsAtPos(line.from + mid)
    if (c && c.left <= x) a = mid
    else b = mid - 1
  }
  return line.from + a
}

/**
 * The live-preview state field: renders inactive blocks as HTML widgets,
 * leaving the block containing the caret as editable source.
 * (Block replace decorations must come from a StateField, not a ViewPlugin.)
 */
export function livePreview(dirSlash: string) {
  const cache = new Map<string, string>()
  return [
    StateField.define<DecorationSet>({
      create(state) {
        return buildDecorations(state, dirSlash, cache)
      },
      update(decos, tr) {
        if (tr.docChanged || tr.selection) {
          return buildDecorations(tr.state, dirSlash, cache)
        }
        return decos
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown(event: MouseEvent, view: EditorView) {
          const target = event.target as HTMLElement | null
          if (target?.closest('.cm-md-widget')) return false // widgets handle their own click
          // plain single left-click only — shift-click (extend), double/triple
          // click (select word/line) and modifiers stay with native behavior
          if (
            event.button !== 0 ||
            event.detail > 1 ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          ) {
            return false
          }
          // CM6's own precise mapping is unreliable around collapsed block
          // widgets (returns null or a line-end position); map the click via
          // our binary search instead
          const pos = posFromPointMapped(view, event.clientX, event.clientY)
          if (pos == null) return false
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
          view.focus()
          return true
        },
      }),
    ),
    Prec.highest(
      keymap.of([
        {
          key: 'ArrowUp',
          run: (view) => blockAwareVerticalMotion(view, -1),
        },
        {
          key: 'ArrowDown',
          run: (view) => blockAwareVerticalMotion(view, 1),
        },
      ]),
    ),
  ]
}
