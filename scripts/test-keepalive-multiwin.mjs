// E2E: tab keep-alive (scroll/edit state survives switches) + multi-window
// (per-window tabs, cross-window stale broadcast, rename migration, session).
// Usage: node scripts/test-keepalive-multiwin.mjs <setup|run1|run2> [port]
import { writeFileSync, readFileSync, unlinkSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.argv[2] || 'run1'
const port = process.argv[3] || '9222'

const ROOT = 'D:\\coding\\md_viewer'
const A = join(ROOT, 'samples', 'keepalive-a.md')
const A_RENAMED = join(ROOT, 'samples', 'keepalive-a-renamed.md')
const B = join(ROOT, 'samples', 'keepalive-b.md')
const C = join(ROOT, 'samples', 'keepalive-c.md')
const SESSION = join(ROOT, '.dev-profile', 'session.json')

if (phase === 'setup') {
  let long = '# 文档 A（长）\n\n'
  for (let i = 1; i <= 120; i++) long += `段落 ${i}：内容一二三四五六七八九十，填充文本。\n\n`
  writeFileSync(A, long, 'utf8')
  writeFileSync(B, '# 文档 B\n\n短文档。\n', 'utf8')
  writeFileSync(C, '# 文档 C\n\n第三个文档。\n', 'utf8')
  writeFileSync(SESSION, '{"windows":[]}', 'utf8')
  if (existsSync(A_RENAMED)) unlinkSync(A_RENAMED)
  console.log('setup done')
  process.exit(0)
}

if (phase === 'setup-cli') {
  let long = '# 文档 A（长）\n\n'
  for (let i = 1; i <= 120; i++) long += `段落 ${i}：内容一二三四五六七八九十，填充文本。\n\n`
  writeFileSync(A, long, 'utf8')
  writeFileSync(B, '# 文档 B\n\n短文档。\n', 'utf8')
  writeFileSync(C, '# 文档 C\n\n第三个文档。\n', 'utf8')
  if (existsSync(A_RENAMED)) unlinkSync(A_RENAMED)
  // pre-seed a saved session: two tabs, B active — launching with a CLI file
  // must RESTORE these and add the file, not replace them
  writeFileSync(
    SESSION,
    JSON.stringify({ windows: [{ tabs: [A, B], activePath: B }] }),
    'utf8',
  )
  console.log('setup-cli done')
  process.exit(0)
}

async function connect(predicate) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find(predicate)
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200))
    return r.result.result.value
  }
  return { evalJs, send, close: () => ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`)
  if (!cond) process.exitCode = 1
}

const firstPage = (t) => t.type === 'page' && !t.url.startsWith('devtools')

if (phase === 'run1') {
  // window 1 was launched with A on the CLI
  const w1 = await connect(firstPage)
  await sleep(500)
  await w1.evalJs(`window.alert = (m) => { window.__alertMsg = m }; 'ok'`)

  // --- keep-alive: scroll position survives tab switches ---
  await w1.evalJs(`(() => {
    const s = document.querySelector('.md-scroll')
    if (!s) return 'no scroller'
    s.scrollTop = 3000
    return s.scrollTop
  })()`)
  await sleep(300)
  // await the invoke fully: openFile awaits readFile in main, a fire-and-forget
  // call races the next activateTab and flips activePath back
  await w1.evalJs(`window.viewer.openPath(${JSON.stringify(B.replace(/\\/g, '/'))})`)
  await sleep(300)
  const hiddenPanes = await w1.evalJs(`document.querySelectorAll('.tab-pane.keep').length`)
  check('inactive panes hidden but mounted', hiddenPanes === 1, `keep=${hiddenPanes}`)
  await w1.evalJs(`window.viewer.activateTab(${JSON.stringify(A)})`)
  await sleep(500)
  const top = await w1.evalJs(`document.querySelector('.tab-pane.active .md-scroll')?.scrollTop`)
  if (Math.abs(top - 3000) >= 80) {
    console.log('DEBUG:', await w1.evalJs(`JSON.stringify({
      classes: [...document.querySelectorAll('.tab-pane')].map(p => p.className),
      activeTop: document.querySelector('.tab-pane.active .md-scroll')?.scrollTop,
      firstTop: document.querySelector('.md-scroll')?.scrollTop,
      activeScrollH: document.querySelector('.tab-pane.active .md-scroll')?.scrollHeight,
    })`))
  }
  check('scroll restored after switch', Math.abs(top - 3000) < 80, `top=${top}`)

  // --- keep-alive: edit buffer survives tab switches ---
  await w1.evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true })); undefined`)
  await sleep(900)
  await w1.evalJs(`(() => {
    const v = window.__cmView
    v.dispatch({ changes: { from: 0, to: 0, insert: 'KEEPALIVE-MARK ' } })
  })()`)
  await sleep(200)
  await w1.evalJs(`window.viewer.activateTab(${JSON.stringify(B)})`)
  await sleep(400)
  await w1.evalJs(`window.viewer.activateTab(${JSON.stringify(A)})`)
  await sleep(600)
  const kept = await w1.evalJs(`(() => {
    const v = window.__cmView
    return {
      editor: !!document.querySelector('.cm-editor'),
      marker: v ? v.state.doc.toString().includes('KEEPALIVE-MARK') : false,
    }
  })()`)
  check('edit buffer survives switch', !!kept?.editor && !!kept?.marker, JSON.stringify(kept))

  // --- multi-window: Ctrl+Shift+N ---
  const before = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const beforeIds = before.filter(firstPage).map((t) => t.id)
  await w1.evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); undefined`)
  await sleep(1500)
  const after = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const newTarget = after.find((t) => firstPage(t) && !beforeIds.includes(t.id))
  check('Ctrl+Shift+N opens second window', !!newTarget)
  const w2 = await connect((t) => t.id === newTarget.id)

  // per-window tab isolation
  await w2.evalJs(`window.viewer.getState().then(s => window.__w2tabs0 = s.tabs.length); undefined`)
  await sleep(200)
  const w2tabs0 = await w2.evalJs(`window.__w2tabs0`)
  check('new window starts empty', w2tabs0 === 0, `tabs=${w2tabs0}`)
  await w2.evalJs(`window.viewer.openPath(${JSON.stringify(C.replace(/\\/g, '/'))})`)
  await sleep(400)
  const w2state = await w2.evalJs(`window.viewer.getState().then(s => s.tabs.map(t => t.path))`)
  check('window 2 has its own tab', w2state.length === 1 && w2state[0] === C, JSON.stringify(w2state))
  const w1state = await w1.evalJs(`window.viewer.getState().then(s => s.tabs.length)`)
  check('window 1 tabs unaffected', w1state === 2, `tabs=${w1state}`)

  // same file in both windows -> shared stale broadcast
  await w2.evalJs(`window.viewer.openPath(${JSON.stringify(A.replace(/\\/g, '/'))})`)
  await sleep(400)
  appendFileSync(A, '\n外部追加段落。\n', 'utf8')
  await sleep(1300)
  const stale1 = await w1.evalJs(`window.viewer.getState().then(s => s.tabs.find(t => t.path === ${JSON.stringify(A)})?.stale)`)
  const stale2 = await w2.evalJs(`window.viewer.getState().then(s => s.tabs.find(t => t.path === ${JSON.stringify(A)})?.stale)`)
  check('stale broadcast to both windows', stale1 === true && stale2 === true, `w1=${stale1} w2=${stale2}`)

  // rename in window 2 migrates the tab in window 1 too
  await w2.evalJs(`window.viewer.renameFile(${JSON.stringify(A)}, 'keepalive-a-renamed.md').then(r => window.__rn = r); undefined`)
  await sleep(600)
  const rn = await w2.evalJs(`window.__rn`)
  check('rename via window 2 ok', rn?.ok === true && rn.path === A_RENAMED, JSON.stringify(rn))
  const w1paths = await w1.evalJs(`window.viewer.getState().then(s => s.tabs.map(t => t.path))`)
  check('rename migrated in window 1', w1paths.includes(A_RENAMED) && !w1paths.includes(A), JSON.stringify(w1paths))

  // session records both windows
  const sess = JSON.parse(readFileSync(SESSION, 'utf8'))
  check('session has two windows', Array.isArray(sess.windows) && sess.windows.length === 2, JSON.stringify(sess))

  // closing window 2 shrinks the session to window 1
  await w2.evalJs(`window.close(); undefined`)
  await sleep(1200)
  const sess2 = JSON.parse(readFileSync(SESSION, 'utf8'))
  check('closing a window shrinks session', sess2.windows.length === 1 && sess2.windows[0].tabs.includes(A_RENAMED), JSON.stringify(sess2))
  w1.close()
  console.log(results.join('\n'))
  process.exit(process.exitCode || 0)
}

if (phase === 'run3') {
  // app was launched WITH a CLI file (C) on top of a saved [A, B] session
  const w1 = await connect(firstPage)
  await sleep(800)
  const st = await w1.evalJs(`window.viewer.getState()`)
  const paths = st.tabs.map((t) => t.path)
  check(
    'CLI launch restores session + adds file',
    paths.length === 3 && paths[0] === A && paths[1] === B && paths[2] === C && st.activePath === C,
    JSON.stringify(paths),
  )
  const h1 = await w1.evalJs(`document.querySelector('.tab-pane.active .markdown-body h1')?.textContent`)
  check('CLI file rendered active', h1 === '文档 C', String(h1))
  w1.close()
  console.log(results.join('\n'))
  process.exit(process.exitCode || 0)
}

if (phase === 'run4') {
  // tear-off: drag tab A below the tab bar -> detaches into a new window
  const w1 = await connect(firstPage)
  await sleep(600)
  const before = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(firstPage)
  const tabRect = await w1.evalJs(`(() => {
    const tab = [...document.querySelectorAll('.tab')].find(t => t.title.includes('keepalive-a.md') || t.textContent.includes('keepalive-a.md'))
    if (!tab) return null
    const r = tab.getBoundingClientRect()
    const bar = document.querySelector('.tab-bar').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, barBottom: bar.bottom }
  })()`)
  check('found tab to drag', !!tabRect)
  if (tabRect) {
    const send = async (type, x, y) => {
      await w1.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    }
    await send('mousePressed', tabRect.x, tabRect.y)
    await send('mouseMoved', tabRect.x, tabRect.y)
    await send('mouseMoved', tabRect.x, tabRect.y + 20)
    await send('mouseMoved', tabRect.x + 30, tabRect.y + 80) // clearly below the bar
    await send('mouseReleased', tabRect.x + 30, tabRect.y + 80)
    await sleep(1500)
    const after = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(firstPage)
    check('tear-off created a new window', after.length === before.length + 1, `pages=${after.length}`)
    const newPage = after.find((p) => !before.some((b) => b.id === p.id))
    if (newPage) {
      const w2 = await connect((t) => t.id === newPage.id)
      await sleep(600)
      const w2paths = await w2.evalJs(`window.viewer.getState().then(s => s.tabs.map(t => t.path))`)
      check('torn tab lives in new window', w2paths.length === 1 && w2paths[0] === A, JSON.stringify(w2paths))
      const w2h1 = await w2.evalJs(`document.querySelector('.tab-pane.active .markdown-body h1, .markdown-body h1')?.textContent`)
      check('torn tab rendered', w2h1 === '文档 A（长）', String(w2h1))
      w2.close()
    }
    const w1paths = await w1.evalJs(`window.viewer.getState().then(s => s.tabs.map(t => t.path))`)
    check('source window kept the rest', !w1paths.includes(A) && w1paths.includes(B) && w1paths.includes(C), JSON.stringify(w1paths))
    // plain click on a remaining tab still selects it (drag didn't break clicks)
    const bRect = await w1.evalJs(`(() => {
      const tab = [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('keepalive-b.md'))
      if (!tab) return null
      const r = tab.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (bRect) {
      await w1.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bRect.x, y: bRect.y, button: 'left', clickCount: 1 })
      await w1.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bRect.x, y: bRect.y, button: 'left', clickCount: 1 })
      await sleep(400)
      const active = await w1.evalJs(`window.viewer.getState().then(s => s.activePath)`)
      check('plain click still selects tab', active === B, String(active))
    }
    // cleanup
    await w1.evalJs(`window.viewer.closeTab(${JSON.stringify(B)}); undefined`)
    await sleep(200)
    await w1.evalJs(`window.viewer.closeTab(${JSON.stringify(C)}); undefined`)
    await sleep(300)
    for (const f of [A, B, C]) if (existsSync(f)) unlinkSync(f)
  }
  console.log(results.join('\n'))
  w1.close()
  process.exit(process.exitCode || 0)
}

if (phase === 'run2') {
  // after full relaunch: the surviving window's tabs come back
  const w1 = await connect(firstPage)
  await sleep(800)
  const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(firstPage)
  check('one window restored', pages.length === 1, `pages=${pages.length}`)
  const st = await w1.evalJs(`window.viewer.getState()`)
  const paths = st.tabs.map((t) => t.path)
  check('window tabs restored', paths.length === 2 && paths[0] === A_RENAMED && paths[1] === B, JSON.stringify(paths))
  const h1 = await w1.evalJs(`document.querySelector('.markdown-body h1')?.textContent`)
  check('active tab content rendered', h1 === '文档 A（长）', String(h1))
  // cleanup
  await w1.evalJs(`window.viewer.closeTab(${JSON.stringify(A_RENAMED)}); undefined`)
  await sleep(200)
  await w1.evalJs(`window.viewer.closeTab(${JSON.stringify(B)}); undefined`)
  await sleep(300)
  unlinkSync(B)
  unlinkSync(C)
  console.log(results.join('\n'))
  w1.close()
  process.exit(process.exitCode || 0)
}
