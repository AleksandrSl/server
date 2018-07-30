#!/usr/bin/env node

let Server = require('../../server')

let app = new Server({
  subprotocol: '1.0.0',
  supports: '1.x'
})
app.nodeId = 'server:FnXaqDxY'

app.on('error', e => console.log(`Error event: ${ e.message }`))

new Promise((resolve, reject) => {
  setTimeout(() => {
    let error = new Error('Test Error')
    error.stack = `${ error.stack.split('\n')[0] }\nfake stacktrace`
    reject(error)
  }, 50)
})
