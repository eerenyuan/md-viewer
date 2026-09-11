// E2E: TOC panel, anchor scroll, PDF export, live-preview mermaid.
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => (ws.onopen = res))
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evalJS = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    ?.result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. open TOC
await evalJS(`[...document.querySelectorAll('.viewer-toolbar button')].find(b => b.textContent.includes('目录')).click()`)
await sleep(600)
console.log(
  '1. TOC open:',
  await evalJS(`JSON.stringify({ items: document.querySelectorAll('.toc-item').length })`),
)

// 2. click last TOC item -> scroll
const before = await evalJS(`document.querySelector('.md-scroll').scrollTop`)
await evalJS(`[...document.querySelectorAll('.toc-item')].pop().click()`)
await sleep(1200)
console.log(
  '2. TOC scroll:',
  before,
  '->',
  await evalJS(
    `JSON.stringify({ y: document.querySelector('.md-scroll').scrollTop, current: document.querySelector('.toc-item.current')?.textContent })`,
  ),
)

// 3. PDF export (autoPath skips the save dialog)
const pdf = await evalJS(`window.viewer.exportPdf({ autoPath: 'samples/test-export.pdf' })`)
console.log('3. PDF:', JSON.stringify(pdf))

// 4. live preview mermaid
await evalJS(`[...document.querySelectorAll('.viewer-toolbar button')].find(b => b.textContent.includes('编辑')).click()`)
await sleep(3000)
console.log(
  '4. editor mermaid:',
  await evalJS(
    `JSON.stringify({ widgets: document.querySelectorAll('.cm-md-widget').length, mermaidSvg: document.querySelectorAll('.cm-md-widget svg').length, pending: document.querySelectorAll('.cm-md-widget .mermaid-pending').length })`,
  ),
)
ws.close()
