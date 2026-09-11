const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => (ws.onopen = res))
let seq = 0
const pending = new Map()
const events = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  } else if (m.method) {
    events.push(m)
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Page.reload')
await new Promise((r) => setTimeout(r, 3000))

for (const ev of events) {
  if (ev.method === 'Runtime.exceptionThrown') {
    const d = ev.params.exceptionDetails
    console.log('EXCEPTION:', d.text, d.exception?.description ?? '')
  }
  if (ev.method === 'Log.entryAdded') {
    const e = ev.params.entry
    if (e.level === 'error') console.log('LOG ERROR:', e.text, e.url ?? '')
  }
  if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
    console.log('CONSOLE ERROR:', JSON.stringify(ev.params.args))
  }
}
console.log('total events:', events.length)
ws.close()
