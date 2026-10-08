// E2E: clicking a rendered (widget) block places the caret at the clicked spot.
// Usage: node scripts/test-widget-click.mjs [port]
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] || '9222'
const mdPath = join('samples', 'widget-click-test.md')

let sample = '# 点击定位测试\n\n'
for (let i = 1; i <= 40; i++) sample += `填充段落 ${i}，内容一二三四五六七八九十。\n\n`
sample += '## 尾部标题\n\n尾部。\n'
writeFileSync(mdPath, sample, 'utf8')

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws error'))
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
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Runtime.enable')

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await evalJs(`window.viewer.closeTab(${JSON.stringify('D:\\coding\\md_viewer\\samples\\widget-click-test.md')}).then(() => {}).catch(() => {})`)
await sleep(300)
await evalJs(`window.viewer.openPath(${JSON.stringify('D:/coding/md_viewer/' + mdPath)}).then(() => {})`)
await sleep(600)

await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true })); undefined`)
await sleep(800)

const out = await evalJs(`(async () => {
  const view = window.__cmView
  if (!view) return JSON.stringify({ err: 'no __cmView', mode: document.querySelector('.cm-scroller') ? 'edit' : 'view' })
  const doc = view.state.doc.toString()
  // only widgets actually inside the viewport are clickable by a real user;
  // sample the click at 40% of the *text* width (not the block container)
  const widgets = [...document.querySelectorAll('.cm-md-widget')]
  const target = widgets.find((w) => (w.textContent || '').includes('填充段落 25，'))
  if (!target) return JSON.stringify({ err: 'widget not found', widgetCount: widgets.length })
  // bring it into the viewport first — a real user can only click what's visible
  target.scrollIntoView({ block: 'center' })
  await new Promise(r => setTimeout(r, 300))
  const vr = target.getBoundingClientRect()
  if (vr.top < 0 || vr.bottom > window.innerHeight) {
    return JSON.stringify({ err: 'widget not in view after scroll', top: vr.top, bottom: vr.bottom })
  }
  const textNode = (function findText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.data.trim()) return n
      const deep = findText(n)
      if (deep) return deep
    }
    return null
  })(target)
  if (!textNode) return JSON.stringify({ err: 'no text node' })
  const tr = document.createRange()
  tr.selectNodeContents(textNode)
  const rect = tr.getBoundingClientRect()
  const x = rect.left + rect.width * 0.4
  const y = rect.top + rect.height / 2
  target.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 300))
  const head = view.state.selection.main.head
  const blockStart = doc.indexOf('填充段落 25，')
  const textLen = textNode.data.trim().length
  return JSON.stringify({ head, blockStart, textLen, frac: (head - blockStart) / textLen })
})()`)

console.log(out)
const r = JSON.parse(out)
const results = []
results.push(`${!r.err ? 'PASS' : 'FAIL'} widget click test setup | ${r.err ?? 'ok'}`)
if (!r.err) {
  // caret should land near the clicked 40% point of the paragraph text
  results.push(`${r.head > r.blockStart && r.head < r.blockStart + r.textLen ? 'PASS' : 'FAIL'} caret inside clicked block | head=${r.head} blockStart=${r.blockStart}`)
  results.push(`${r.frac > 0.2 && r.frac < 0.65 ? 'PASS' : 'FAIL'} caret near clicked position (40%) | frac=${r.frac?.toFixed(2)}`)
}
console.log(results.join('\n'))
const failed = results.filter((x) => x.startsWith('FAIL')).length
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
ws.close()
try {
  unlinkSync(mdPath)
} catch {
  /* ignore */
}
process.exitCode = failed === 0 ? 0 : 1
