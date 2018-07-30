#!/usr/bin/env node

let Server = require('../../server')

let app = new Server({
  subprotocol: '1.0.0',
  supports: '1.x',
  port: 2000,
  reporter: 'bunyan'
})
app.nodeId = 'server:FnXaqDxY'

app.auth(() => Promise.resolve(true))

app.listen()
