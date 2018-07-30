#!/usr/bin/env node

let Server = require('../../server')

let app = new Server({
  subprotocol: '1.0.0',
  supports: '1.x',
  port: 2000
})
app.nodeId = 'server:FnXaqDxY'

app.auth(() => Promise.resolve(true))

app.unbind.push(() => new Promise(resolve => {
  setTimeout(() => {
    process.stderr.write(' Custom destroy task finished\n')
    resolve()
  }, 10)
}))

app.listen()

process.on('message', msg => {
  if (msg === 'close') {
    console.error('close')
    app.destroy()
  }
})
