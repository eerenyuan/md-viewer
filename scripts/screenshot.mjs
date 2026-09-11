// Capture a screenshot from the Electron app's CDP endpoint.
// Usage: node scripts/screenshot.mjs <out.png> [port]
import { writeFileSync } from 'node:fs'

const out = process.argv[2] || 'shot.png'
const port = process.argv[3] || '9222'

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) {
  console.error('no page target. targets:', JSON.stringify(targets))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = (e) => rej(new Error('ws error: ' + e.message))
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

await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.error || !shot.result?.data) {
  console.error('screenshot failed:', JSON.stringify(shot.error ?? 'no data'))
  process.exit(1)
}
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('saved', out, 'from', page.url)
ws.close()
