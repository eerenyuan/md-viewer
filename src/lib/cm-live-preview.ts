import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view'
import { StateField, type Range, type EditorState } from '@codemirror/state'
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

    // clicking a rendered block puts the caret into its source
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({
        selection: { anchor: Math.min(this.blockStart + 1, view.state.doc.length) },
        scrollIntoView: true,
      })
    })
    return wrap
  }
  ignoreEvent() {
    return false
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

  for (const b of blocks) {
    if (b.kind === 'frontmatter') continue // keep front matter as plain source
    if (b === active) continue
    const endLine = doc.line(b.lineTo)
    const to = Math.min(endLine.to + 1, doc.length) // swallow the trailing newline
    ranges.push(
      Decoration.replace({
        widget: new BlockWidget(blockHtml(b), b.from, dirSlash),
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
 * The live-preview state field: renders inactive blocks as HTML widgets,
 * leaving the block containing the caret as editable source.
 * (Block replace decorations must come from a StateField, not a ViewPlugin.)
 */
export function livePreview(dirSlash: string) {
  const cache = new Map<string, string>()
  return StateField.define<DecorationSet>({
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
  })
}
