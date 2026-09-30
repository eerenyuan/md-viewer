import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { katex } from '@mdit/plugin-katex'
import anchor from 'markdown-it-anchor'
import hljs from 'highlight.js'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fallthrough */
      }
    }
    return ''
  },
})
  .use(taskLists)
  .use(katex)
  .use(anchor, {
    // GitHub-style: lowercase, spaces -> dashes, keep unicode (incl. CJK)
    slugify: (s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[\s]+/g, '-'),
  })

/**
 * Turn Obsidian-style Excalidraw embeds (`![[drawing.excalidraw]]`,
 * `![[drawing|400]]`, optionally without extension) into placeholder divs
 * that the post-processor resolves and renders as inline SVG.
 */
export function preprocessExcalidrawEmbeds(source: string): string {
  return source.replace(/^!\[\[([^\]]+)\]\][ \t]*$/gm, (_full, inner: string) => {
    const [refPart, widthPart] = inner.split('|')
    const target = refPart.trim()
    const isExcalidraw = /\.excalidraw(\.md|\.json)?$/i.test(target)
    const isBare = !target.includes('.')
    if (!isExcalidraw && !isBare) return _full
    const enc = encodeURIComponent(target)
    const width = /^\d+$/.test(widthPart?.trim() ?? '')
      ? ` data-width="${widthPart.trim()}"`
      : ''
    return `<div class="excalidraw-embed" data-ref="${enc}"${width}></div>`
  })
}

export function renderMarkdown(source: string): string {
  return md.render(preprocessExcalidrawEmbeds(source))
}

export function renderInline(source: string): string {
  return md.renderInline(source)
}

/**
 * Resolve a relative image href against the markdown file's directory,
 * then turn it into a local-file:// URL served by the main process.
 */
export function toLocalFileUrl(dirSlash: string, href: string): string {
  let clean = href.split('#')[0].split('?')[0]
  // markdown-it (mdurl) may already percent-encode non-ASCII hrefs; decode
  // first so we never double-encode, then encode once below.
  try {
    clean = decodeURIComponent(clean)
  } catch {
    /* malformed escape sequence: keep raw */
  }
  const isAbsolute = /^([a-zA-Z]:\/|\/|local-file:|https?:|data:)/.test(clean)
  const base = isAbsolute ? '' : dirSlash.replace(/\/+$/, '') + '/'
  const stack: string[] = []
  for (const part of (base + clean).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  const abs = stack.join('/')
  return 'local-file:///' + encodeURI(abs)
}

/** True when an md image href points at an Excalidraw file (handled as embed, not img). */
export function isExcalidrawRef(ref: string): boolean {
  return /\.excalidraw(\.md|\.json)?($|[?#])/i.test(ref)
}
