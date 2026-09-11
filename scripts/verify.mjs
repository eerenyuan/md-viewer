// Verify rendered DOM state via CDP Runtime.evaluate.
// Usage: node scripts/verify.mjs [port]
const port = process.argv[2] || '9222'

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) {
  console.error('no page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = (e) => rej(new Error('ws error'))
})

let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await send('Runtime.enable')

const expr = `JSON.stringify({
  title: document.title,
  h1: document.querySelector('.markdown-body h1')?.textContent ?? null,
  h2Count: document.querySelectorAll('.markdown-body h2').length,
  tables: document.querySelectorAll('.markdown-body table').length,
  tableRows: document.querySelectorAll('.markdown-body table tr').length,
  checkboxes: document.querySelectorAll('.markdown-body input[type=checkbox]').length,
  checkedBoxes: document.querySelectorAll('.markdown-body input[type=checkbox]:checked').length,
  codeBlocks: document.querySelectorAll('.markdown-body pre code').length,
  highlighted: document.querySelectorAll('.markdown-body pre code.hljs').length,
  jsKeyword: !!document.querySelector('.markdown-body .hljs-keyword'),
  blockquote: !!document.querySelector('.markdown-body blockquote'),
  hr: !!document.querySelector('.markdown-body hr'),
  externalLink: document.querySelector('.markdown-body a[href^="https"]')?.href ?? null,
  emptyState: !!document.querySelector('.empty-state'),
  excalWrap: !!document.querySelector('.excalidraw-wrap'),
  canvas: !!document.querySelector('.excalidraw-wrap canvas'),
  embedBoxes: document.querySelectorAll('.excalidraw-embed-box').length,
  embedSvgs: document.querySelectorAll('.excalidraw-embed-box svg').length,
  embedErrors: [...document.querySelectorAll('.embed-error')].map((e) => e.textContent),
  rawWikiLeftover: document.body.textContent.includes('![[sample'),
  mermaidSvgs: document.querySelectorAll('.mermaid-box svg').length,
  mermaidErrors: [...document.querySelectorAll('.mermaid-box.embed-error')].map((e) => e.textContent),
  katexInline: document.querySelectorAll('.markdown-body .katex').length,
  anchorIds: [...document.querySelectorAll('.markdown-body h2[id]')].map((h) => h.id),
  tocItems: document.querySelectorAll('.toc-item').length,
  tocCurrent: document.querySelector('.toc-item.current')?.textContent ?? null,
})`

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log(r.result?.result?.value ?? JSON.stringify(r))
ws.close()
