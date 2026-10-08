// E2E: block-aware vertical motion + double-click caret stability in live preview.
// Usage: node scripts/test-block-motion.mjs [port]
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] || '9222'
const mdPath = join('samples', 'block-motion-test.md')

let sample = '# 块移动测试\n\n'
sample += '第一块行一\n第一块行二\n第一块行三\n\n'
sample += '第二块行一\n第二块行二\n第二块行三\n\n'
sample += '尾部段落，这里有足够文字用来渲染点击测试的宽度目标内容。\n'
writeFileSync(mdPath, sample, 'utf8')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
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
  if (r.result.exceptionDetails) {
    const desc = r.result.exceptionDetails.exception?.description ?? 'page exception'
    return JSON.stringify({ err: desc.split('\n').slice(0, 3).join(' | ').slice(0, 260) })
  }
  return r.result.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`)
}

// wait (with retries) until the editor is actually mounted
async function waitFor(expr, timeout = 6000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await evalJs(expr)) return true
    await sleep(150)
  }
  return false
}

await evalJs(`window.viewer.closeTab(${JSON.stringify('D:\\coding\\md_viewer\\samples\\block-motion-test.md')}).then(() => {}).catch(() => {})`)
await sleep(300)
await evalJs(`window.viewer.openPath(${JSON.stringify('D:/coding/md_viewer/' + mdPath)}).then(() => {})`)
await sleep(600)
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true })); undefined`)
if (!(await waitFor(`!!window.__cmView`))) {
  console.log('FAIL editor did not mount')
  console.log('1 FAILED')
  process.exitCode = 1
  process.exit(0)
}

// ---- 1. in-block multi-line up/down is native ----
let out = await evalJs(`(() => {
  const view = window.__cmView
  const doc = view.state.doc
  const l = doc.line(4) // 第一块行二 (block's second line)
  view.dispatch({ selection: { anchor: l.from } })
  const before = view.state.selection.main.head
  const content = document.querySelector('.cm-content')
  content.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  const after = view.state.selection.main.head
  return JSON.stringify({ before, after, nowAt: doc.lineAt(after).text, nowLine: doc.lineAt(after).number })
})()`)
let r = JSON.parse(out)
check('in-block ArrowUp moves one line up', r.after < r.before && r.nowAt.includes('行一'), `nowLine=${r.nowLine} nowAt=${r.nowAt}`)

// ---- 2. crossing down into the next block lands on its first line ----
out = await evalJs(`(() => {
  const view = window.__cmView
  const doc = view.state.doc
  // put caret at the last line of block 1 (第一块行三)
  const ln = doc.lines
  let target = null
  for (let i = 1; i <= ln; i++) if (doc.line(i).text.includes('第一块行三')) target = doc.line(i)
  view.dispatch({ selection: { anchor: target.from } })
  const content = document.querySelector('.cm-content')
  content.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  const after = view.state.selection.main.head
  return JSON.stringify({ after, nowAt: doc.lineAt(after).text })
})()`)
r = JSON.parse(out)
check('cross-block ArrowDown lands on next block first line', r.nowAt.includes('第二块行一'), `nowAt=${r.nowAt}`)

// ---- 3. crossing up from below lands on the block's LAST line ----
out = await evalJs(`(() => {
  const view = window.__cmView
  const doc = view.state.doc
  let target = null
  for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.includes('第二块行一')) target = doc.line(i)
  view.dispatch({ selection: { anchor: target.from } })
  const content = document.querySelector('.cm-content')
  content.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  const after = view.state.selection.main.head
  return JSON.stringify({ after, nowAt: doc.lineAt(after).text })
})()`)
r = JSON.parse(out)
check('cross-block ArrowUp lands on prev block last line', r.nowAt.includes('第一块行三'), `nowAt=${r.nowAt}`)

// ---- 4. second click on the (now-source) line keeps the caret there ----
out = await evalJs(`(async () => {
  const view = window.__cmView
  const doc = view.state.doc.toString()
  // click the rendered widget of the tail paragraph first
  const w = [...document.querySelectorAll('.cm-md-widget')].find(x => (x.textContent || '').includes('尾部段落'))
  if (!w) return JSON.stringify({ err: 'no widget' })
  w.scrollIntoView({ block: 'center' })
  await new Promise(r => setTimeout(r, 250))
  const textNode = (function findText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.data.trim()) return n
      const deep = findText(n)
      if (deep) return deep
    }
    return null
  })(w)
  const tr = document.createRange()
  tr.selectNodeContents(textNode)
  const rect = tr.getBoundingClientRect()
  w.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + rect.width * 0.4, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 250))
  const first = view.state.selection.main.head
  // now the block is source; sample 70% of the *source text* width and report
  // back — node will replay it as a real CDP mouse press+release
  const line = view.state.doc.lineAt(first)
  const lineEl = view.domAtPos(line.from)
  const host = lineEl.node.nodeType === 1 ? lineEl.node : lineEl.node.parentElement
  let srcTextNode = null
  for (let n = host.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.data.trim()) { srcTextNode = n; break }
  if (!srcTextNode && host.nodeType === 3) srcTextNode = host
  let tr2rect = host.getBoundingClientRect()
  if (srcTextNode) {
    const tr2 = document.createRange()
    tr2.selectNodeContents(srcTextNode)
    tr2rect = tr2.getBoundingClientRect()
  }
  return JSON.stringify({ first, lineFrom: line.from, lineLen: line.to - line.from, x: tr2rect.left + tr2rect.width * 0.7, y: tr2rect.top + tr2rect.height / 2 })
})()`)
const clickInfo = JSON.parse(out)

// real mouse click via CDP Input domain (synthetic DOM events lack mouseup,
// and CM6's click pipeline expects the full press-release sequence)
if (!clickInfo.err) {
  // CM6's precise posAtCoords may answer from a stale height map when the
  // window is backgrounded; our fallback mapping in the mousedown handler is
  // binary-search based and works regardless — just give it a frame first
  await evalJs(`(async () => {
    const view = window.__cmView
    view.requestMeasure()
    await new Promise(r => setTimeout(r, 150))
    return true
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickInfo.x, y: clickInfo.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickInfo.x, y: clickInfo.y, button: 'left', clickCount: 1 })
  await sleep(300)
  out = await evalJs(`(() => {
  const view = window.__cmView
  const second = view.state.selection.main.head
  return JSON.stringify({ second })
})()`)
  const sr = JSON.parse(out)
  clickInfo.second = sr.second
  clickInfo.frac = (sr.second - clickInfo.lineFrom) / clickInfo.lineLen
}

r = clickInfo
check('second click stays on the same line', !r.err && r.second >= r.lineFrom && r.second <= r.lineFrom + r.lineLen, JSON.stringify(r).slice(0, 140))
check('second click lands near clicked spot (70%)', !r.err && r.frac > 0.45 && r.frac < 0.95, `frac=${r.frac?.toFixed(2)}`)

// ---- 5. cross-block click keeps the viewport on the caret ----
out = await evalJs(`(async () => {
  const view = window.__cmView
  const doc = view.state.doc
  // caret currently in the tail block; put it back into block 1 first
  let l1 = null
  for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.includes('第一块行一')) l1 = doc.line(i)
  view.dispatch({ selection: { anchor: l1.from } })
  await new Promise(r => setTimeout(r, 200))
  // scroll away and click a distant rendered widget (the heading at doc top)
  const w = [...document.querySelectorAll('.cm-md-widget')].find(x => (x.textContent || '').includes('块移动测试'))
  if (!w) return JSON.stringify({ err: 'no heading widget' })
  w.scrollIntoView({ block: 'center' })
  await new Promise(r => setTimeout(r, 200))
  const rect = w.getBoundingClientRect()
  w.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 40, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 400))
  const head = view.state.selection.main.head
  const caretCoords = view.coordsAtPos(head)
  return JSON.stringify({
    head,
    headLine: doc.lineAt(head).text.slice(0, 10),
    caretY: caretCoords ? Math.round(caretCoords.top) : null,
    innerH: window.innerHeight,
  })
})()`)
r = JSON.parse(out)
check('cross-block click moves caret into target block', !r.err && /块移动测试/.test(r.headLine || ''), JSON.stringify(r).slice(0, 140))
check('cross-block click keeps caret inside viewport', !r.err && r.caretY !== null && r.caretY > -60 && r.caretY < r.innerH + 60, `caretY=${r.caretY} innerH=${r.innerH}`)

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
