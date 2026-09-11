// E2E: live preview editing — enter edit mode, verify widgets, type, save, verify file.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

copyFileSync('samples/demo.md', 'samples/demo.md.bak')

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
const evalJS = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

// 1. enter edit mode via toolbar
await evalJS(`document.querySelector('.viewer-toolbar button').click()`)
await sleep(1000)
let state = await evalJS(`JSON.stringify({
  editor: !!document.querySelector('.cm-editor'),
  widgets: document.querySelectorAll('.cm-md-widget').length,
  hWidgets: document.querySelectorAll('.cm-md-widget h1, .cm-md-widget h2').length,
  preWidgets: document.querySelectorAll('.cm-md-widget pre').length,
  tableWidgets: document.querySelectorAll('.cm-md-widget table').length,
  sourceVisible: document.querySelector('.cm-line')?.textContent ?? '',
})`)
console.log('1. edit mode:', state)

// 2. click into the middle of the doc, verify caret block becomes source
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 400, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 400, button: 'left', clickCount: 1 })
await sleep(600)
state = await evalJS(`JSON.stringify({
  widgets: document.querySelectorAll('.cm-md-widget').length,
  focused: !!document.querySelector('.cm-editor.cm-focused'),
})`)
console.log('2. after click:', state)

// 3. type something
await send('Input.insertText', { text: 'EDIT-MARKER ' })
await sleep(600)
state = await evalJS(`JSON.stringify({
  saveBtn: document.querySelector('.viewer-toolbar button')?.textContent.trim(),
  saveDisabled: document.querySelector('.viewer-toolbar button')?.disabled,
})`)
console.log('3. after typing:', state)

// 4. Ctrl+S via keyboard event
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 })
await sleep(1200)

const saved = readFileSync('samples/demo.md', 'utf8')
console.log('4. file has marker:', saved.includes('EDIT-MARKER'))
state = await evalJS(`JSON.stringify({
  saveBtn: document.querySelector('.viewer-toolbar button')?.textContent.trim(),
})`)
console.log('   toolbar:', state)

// 5. Ctrl+E back to view mode
await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 })
await sleep(800)
state = await evalJS(`JSON.stringify({
  editorGone: !document.querySelector('.cm-editor'),
  rendered: !!document.querySelector('.markdown-body h1'),
})`)
console.log('5. back to view:', state)

// restore
writeFileSync('samples/demo.md', readFileSync('samples/demo.md.bak', 'utf8'))
console.log('demo.md restored')
ws.close()
