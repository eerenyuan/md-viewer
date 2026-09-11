// E2E: drag a shape in edit mode, click save, verify file on disk changed.
import { readFileSync } from 'node:fs'

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

const before = JSON.parse(readFileSync('samples/demo.excalidraw', 'utf8'))
console.log('rect x before:', before.elements[0].x)

// 1. enter edit mode
await evalJS(`document.querySelector('.viewer-toolbar button').click()`)
await sleep(800)

// 2. drag the rectangle (120,100)-(360,240) by (+80,+60)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 180, button: 'left', clickCount: 1 })
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 200 + 10 * i,
    y: 180 + 7.5 * i,
    button: 'left',
    buttons: 1,
  })
  await sleep(30)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 280, y: 240, button: 'left', clickCount: 1 })
await sleep(800)

// 3. check dirty state
const state = await evalJS(`JSON.stringify({
  buttons: [...document.querySelectorAll('.viewer-toolbar button')].map(b => b.textContent.trim()),
  saveDisabled: document.querySelector('.viewer-toolbar button').disabled,
})`)
console.log('after drag:', state)

// 4. click save
await evalJS(`document.querySelector('.viewer-toolbar button').click()`)
await sleep(1200)

// 5. verify on disk
const after = JSON.parse(readFileSync('samples/demo.excalidraw', 'utf8'))
console.log('rect x after:', after.elements[0].x)
console.log('moved:', after.elements[0].x !== before.elements[0].x ? 'YES' : 'NO')
console.log('valid scene JSON:', Array.isArray(after.elements) ? 'YES' : 'NO')

const finalBtns = await evalJS(`[...document.querySelectorAll('.viewer-toolbar button')].map(b => b.textContent.trim())`)
console.log('toolbar after save:', JSON.stringify(finalBtns))
ws.close()
