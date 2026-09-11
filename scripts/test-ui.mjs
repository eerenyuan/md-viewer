// UI interaction test via CDP: edit-mode toggle + theme toggle.
import { writeFileSync, readFileSync } from 'node:fs'

const port = '9222'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
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
function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- initial state: view mode + canvas
let state = await evalJS(`JSON.stringify({
  canvas: !!document.querySelector('.excalidraw-wrap canvas'),
  toolbarButtons: [...document.querySelectorAll('.viewer-toolbar button')].map(b => b.textContent.trim()),
})`)
console.log('1. initial:', state)

// --- click edit button
await evalJS(`document.querySelector('.viewer-toolbar button').click()`)
await sleep(800)
state = await evalJS(`JSON.stringify({
  toolbarButtons: [...document.querySelectorAll('.viewer-toolbar button')].map(b => b.textContent.trim()),
  editUI: !!document.querySelector('.excalidraw .App-menu') || !!document.querySelector('.excalidraw .panelWrap') || !!document.querySelector('.excalidraw [class*="toolbar"]'),
})`)
console.log('2. after edit click:', state)

// --- click save (should be disabled, nothing changed via mouse)
state = await evalJS(`JSON.stringify({
  saveDisabled: document.querySelector('.viewer-toolbar button')?.disabled,
})`)
console.log('3. save button state:', state)

// --- back to view mode
await evalJS(`[...document.querySelectorAll('.viewer-toolbar button')].pop().click()`)
await sleep(600)
state = await evalJS(`JSON.stringify({
  toolbarButtons: [...document.querySelectorAll('.viewer-toolbar button')].map(b => b.textContent.trim()),
})`)
console.log('4. back to view:', state)

// --- theme: capture body background through the 3 states
const themes = []
for (let i = 0; i < 3; i++) {
  await evalJS(`document.querySelector('.theme-toggle').click()`)
  await sleep(500)
  const bg = await evalJS(`getComputedStyle(document.body).backgroundColor`)
  const label = await evalJS(`document.querySelector('.theme-toggle').textContent.trim()`)
  themes.push(`${label}: ${bg}`)
}
console.log('5. theme cycle:', JSON.stringify(themes))

ws.close()
