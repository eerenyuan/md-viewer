// E2E: code-block copy button, tab rename (F2 / dblclick / Esc / conflict / dirty guard),
// session restore across relaunches.
// Usage: node scripts/test-rename-session.mjs <phase1|phase2|phase3> [port]
// Orchestration (relaunch between phases) is done by the caller.
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.argv[2] || 'phase1'
const port = process.argv[3] || '9222'

const ROOT = 'D:\\coding\\md_viewer'
const A = join(ROOT, 'samples', 'rename-test-a.md') // becomes rename-test-a2.md during phase1
const A2 = join(ROOT, 'samples', 'rename-test-a2.md')
const B = join(ROOT, 'samples', 'rename-test-b.md')
const SESSION = join(ROOT, '.dev-profile', 'session.json')

if (phase === 'setup') {
  // must run BEFORE the app launches: the CLI-opened file has to exist on disk
  writeFileSync(A, '# 文档 A\n\n```js\nconsole.log("hello")\n```\n\n正文段落。\n', 'utf8')
  writeFileSync(B, '# 文档 B\n\n内容。\n', 'utf8')
  writeFileSync(SESSION, '{"tabs":[],"activePath":null}', 'utf8')
  if (existsSync(A2)) unlinkSync(A2)
  console.log('setup done')
  process.exit(0)
}

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
  if (r.result.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`)
  if (!cond) process.exitCode = 1
}

if (phase === 'phase1') {
  // open both docs (app was launched with A on the CLI)
  await evalJs(`window.viewer.openPath(${JSON.stringify(B.replace(/\\/g, '/'))}); undefined`)
  await sleep(400)
  await evalJs(`window.viewer.activateTab(${JSON.stringify(A)}); undefined`)
  await sleep(400)
  await evalJs(`window.alert = (m) => { window.__alertMsg = m }; 'ok'`)

  const tabs0 = await evalJs(`window.viewer.getState().then(s => s.tabs.map(t => t.path))`)
  check('two tabs open', tabs0.length === 2 && tabs0.includes(A) && tabs0.includes(B), JSON.stringify(tabs0))

  // --- copy button ---
  const btnCount = await evalJs(`document.querySelectorAll('.code-copy-btn').length`)
  check('copy buttons on code blocks', btnCount >= 1, `count=${btnCount}`)
  const rect = await evalJs(`(() => {
    const b = document.querySelector('.code-copy-btn')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (rect) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await sleep(300)
    const label = await evalJs(`document.querySelector('.code-copy-btn')?.textContent`)
    check('copy click feedback', label === '已复制 ✓', `label=${label}`)
    const clip = await evalJs(`navigator.clipboard.readText().catch(() => null)`)
    check('clipboard has code', !!clip && clip.includes('console.log'), JSON.stringify(clip))
  }

  // --- F2 rename A -> a2 ---
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); undefined`)
  await sleep(200)
  const inputInfo = await evalJs(`(() => {
    const i = document.querySelector('.tab-rename')
    return i ? { val: i.value, focused: document.activeElement === i } : null
  })()`)
  check('F2 opens rename input', !!inputInfo && inputInfo.val === 'rename-test-a.md' && inputInfo.focused, JSON.stringify(inputInfo))
  await evalJs(`(() => {
    const i = document.querySelector('.tab-rename')
    i.value = 'rename-test-a2.md'
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })()`)
  await sleep(600)
  const tabName = await evalJs(`[...document.querySelectorAll('.tab-name')].map(n => n.textContent).join(',')`)
  check('tab renamed in UI', tabName.includes('rename-test-a2.md') && !tabName.includes('rename-test-a.md'), tabName)
  check('file renamed on disk', existsSync(A2) && !existsSync(A), `a2=${existsSync(A2)} a=${existsSync(A)}`)

  // --- rename conflict (via IPC, no UI alert involved) ---
  const conflict = await evalJs(`window.viewer.renameFile(${JSON.stringify(A2)}, 'rename-test-b.md')`)
  check('rename conflict rejected', conflict.ok === false && /已存在/.test(conflict.error || ''), JSON.stringify(conflict))

  // --- dblclick + Esc cancel on B ---
  const bRect = await evalJs(`(() => {
    const tab = [...document.querySelectorAll('.tab')].find(t => t.title.includes('rename-test-b.md') || t.textContent.includes('rename-test-b.md'))
    if (!tab) return null
    const r = tab.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (bRect) {
    // Chromium derives dblclick from the click count — second press must be clickCount 2
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bRect.x, y: bRect.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bRect.x, y: bRect.y, button: 'left', clickCount: 1 })
    await sleep(60)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bRect.x, y: bRect.y, button: 'left', clickCount: 2 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bRect.x, y: bRect.y, button: 'left', clickCount: 2 })
    await sleep(200)
    const hasInput = await evalJs(`!!document.querySelector('.tab-rename')`)
    check('dblclick opens rename input', hasInput)
    await evalJs(`(() => {
      const i = document.querySelector('.tab-rename')
      if (!i) return
      i.value = 'should-not-exist.md'
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })()`)
    await sleep(300)
    const gone = await evalJs(`!document.querySelector('.tab-rename')`)
    const names = await evalJs(`[...document.querySelectorAll('.tab-name')].map(n => n.textContent).join(',')`)
    check('Esc cancels rename', gone && names.includes('rename-test-b.md') && !existsSync(join(ROOT, 'samples', 'should-not-exist.md')), names)
  } else {
    check('find tab B for dblclick', false)
  }

  // --- dirty guard: editing tab must not rename ---
  await evalJs(`window.viewer.activateTab(${JSON.stringify(B)}); undefined`)
  await sleep(300)
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true })); undefined`)
  await sleep(900)
  const typed = await evalJs(`(() => {
    const v = window.__cmView
    if (!v) return null
    v.dispatch({ changes: { from: 0, to: 0, insert: 'X' } })
    return true
  })()`)
  check('enter edit + type', !!typed)
  await sleep(300)
  await evalJs(`window.__alertMsg = null; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); undefined`)
  await sleep(300)
  const alertMsg = await evalJs(`window.__alertMsg`)
  const noInput = await evalJs(`!document.querySelector('.tab-rename')`)
  check('dirty blocks rename with alert', !!alertMsg && /先保存/.test(alertMsg) && noInput, `msg=${alertMsg}`)
  // leave edit mode (double Ctrl+E: first arms the discard confirm)
  for (let i = 0; i < 2; i++) {
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true })); undefined`)
    await sleep(300)
  }

  // --- session file reflects final state ---
  await sleep(300)
  const sess = JSON.parse(readFileSync(SESSION, 'utf8'))
  check(
    'session.json persisted',
    sess.tabs.length === 2 && sess.tabs[0] === A2 && sess.tabs[1] === B && sess.activePath === B,
    JSON.stringify(sess),
  )
} else if (phase === 'phase2') {
  // after relaunch with no CLI file — tabs must come back
  await sleep(600)
  const st = await evalJs(`window.viewer.getState()`)
  const paths = st.tabs.map((t) => t.path)
  check('session restored both tabs', paths.length === 2 && paths[0] === A2 && paths[1] === B, JSON.stringify(paths))
  check('session restored active tab', st.activePath === B, JSON.stringify(st.activePath))
  const nameShown = await evalJs(`document.querySelector('.tab.active .tab-name')?.textContent`)
  check('active tab is B in UI', nameShown === 'rename-test-b.md', String(nameShown))
  // content came back too
  const text = await evalJs(`document.querySelector('.markdown-body h1')?.textContent`)
  check('restored content rendered', text === '文档 B', String(text))
  // now delete A2 from disk — phase3 must drop it from the restored session
  unlinkSync(A2)
} else if (phase === 'phase3') {
  await sleep(600)
  const st = await evalJs(`window.viewer.getState()`)
  const paths = st.tabs.map((t) => t.path)
  check('deleted file dropped from session', paths.length === 1 && paths[0] === B, JSON.stringify(paths))
  // cleanup: close the tab, remove samples
  await evalJs(`window.viewer.closeTab(${JSON.stringify(B)}); undefined`)
  await sleep(300)
  unlinkSync(B)
  console.log(results.join('\n'))
  process.exit(process.exitCode || 0)
}

if (phase !== 'phase3') console.log(results.join('\n'))
ws.close()
