// E2E: multi-tab workflow — open 2 files via CLI, switch, close, empty state.
const port = '9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
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
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value
  }
  return { ws, evalJS }
}

const { ws, evalJS } = await connect()

// 1. first file is open
let state = await evalJS(`JSON.stringify({
  tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent),
  active: document.querySelector('.tab.active')?.textContent,
  h1: document.querySelector('.markdown-body h1')?.textContent,
})`)
console.log('1. single tab:', state)

// 2. open second file via second-instance path
const { execSync } = await import('node:child_process')
execSync('node node_modules/electron/cli.js . samples/embed-demo.md', { cwd: process.cwd() })
await sleep(2500)
state = await evalJS(`JSON.stringify({
  tabCount: document.querySelectorAll('.tab').length,
  active: document.querySelector('.tab.active')?.textContent,
  h1: document.querySelector('.markdown-body h1')?.textContent,
  embedSvgs: document.querySelectorAll('.excalidraw-embed-box svg').length,
})`)
console.log('2. after 2nd file:', state)

// 3. click first tab to switch back
await evalJS(`document.querySelector('.tab:not(.active)').click()`)
await sleep(800)
state = await evalJS(`JSON.stringify({
  active: document.querySelector('.tab.active')?.textContent,
  h1: document.querySelector('.markdown-body h1')?.textContent,
})`)
console.log('3. switched back:', state)

// 4. close active tab via its close button
await evalJS(`document.querySelector('.tab.active .tab-close').click()`)
await sleep(800)
state = await evalJS(`JSON.stringify({
  tabCount: document.querySelectorAll('.tab').length,
  active: document.querySelector('.tab.active')?.textContent,
  h1: document.querySelector('.markdown-body h1')?.textContent,
})`)
console.log('4. closed active:', state)

// 5. close the last tab -> empty state
await evalJS(`document.querySelector('.tab .tab-close').click()`)
await sleep(800)
state = await evalJS(`JSON.stringify({
  tabCount: document.querySelectorAll('.tab').length,
  emptyState: !!document.querySelector('.empty-state'),
})`)
console.log('5. all closed:', state)

ws.close()
