// Stale-banner end-to-end test via CDP.
// Usage: node scripts/test-stale.mjs [port]
// NOTE: edits the real sample file and restores it on exit (fs.cpSync hangs
// on CJK directory names on Node24/Win, so no temp-dir copy).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] || '9222'
const mdPath = join('samples', '中文目录测试', '测试.md')
const original = readFileSync(mdPath, 'utf8')
const extra = '\n\n## 外部追加段落 STALE-TEST\n'

const restore = () => {
  try {
    writeFileSync(mdPath, original, 'utf8')
  } catch {
    /* best effort */
  }
}
process.on('exit', restore)

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

async function state() {
  const expr = `(() => ({
    banner: !!document.querySelector('.stale-banner'),
    bannerText: document.querySelector('.stale-banner-text')?.textContent ?? null,
    tabStale: !!document.querySelector('.tab-stale'),
    h2: [...document.querySelectorAll('.markdown-body h2')].map(h => h.textContent).join(','),
  }))()`
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result.result.value
}

async function click(kind) {
  const sel = kind === 'reload' ? '.stale-banner-btn.primary' : '.stale-banner-btn:not(.primary)'
  await send('Runtime.evaluate', { expression: `document.querySelector('${sel}')?.click()` })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// open the file as a new tab
await send('Runtime.evaluate', {
  expression: `window.viewer.openPath(${JSON.stringify(mdPath)})`,
  awaitPromise: true,
})
await sleep(800)

const results = []
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`)
}

// 1. initial: no banner, original content
let s = await state()
check('initial: no banner', !s.banner)
check('initial: no external section', !s.h2.includes('STALE-TEST'), `h2=[${s.h2}]`)

// 2. external change -> banner appears, content NOT updated
writeFileSync(mdPath, original + extra, 'utf8')
await sleep(1200)
s = await state()
check('after external edit: banner visible', s.banner, `text=${s.bannerText}`)
check('after external edit: content NOT auto-updated', !s.h2.includes('STALE-TEST'))
check('after external edit: tab has stale mark', s.tabStale)

// 3. click reload -> banner gone, content updated
await click('reload')
await sleep(1000)
s = await state()
check('after reload: banner gone', !s.banner)
check('after reload: content updated', s.h2.includes('STALE-TEST'), `h2=[${s.h2}]`)
check('after reload: tab stale mark gone', !s.tabStale)

// 4. change again, then dismiss -> content stays old
writeFileSync(mdPath, original + extra + '\n## 第二次外部修改 DISMISS\n', 'utf8')
await sleep(1200)
s = await state()
check('2nd change: banner back', s.banner)
await click('dismiss')
await sleep(600)
s = await state()
check('after dismiss: banner gone', !s.banner)
check('after dismiss: content NOT updated', !s.h2.includes('DISMISS'))
check('after dismiss: tab stale mark gone', !s.tabStale)

// 5. switching tabs doesn't resurrect a dismissed banner
await send('Runtime.evaluate', {
  expression: `window.viewer.openPath(${JSON.stringify(join('samples', 'demo.md'))})`,
  awaitPromise: true,
})
await sleep(500)
await send('Runtime.evaluate', {
  expression: `window.viewer.activateTab(${JSON.stringify(mdPath)})`,
  awaitPromise: true,
})
await sleep(500)
s = await state()
check('after tab switch: banner stays dismissed', !s.banner)

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
ws.close()
process.exitCode = failed === 0 ? 0 : 1
