#!/usr/bin/env node
var Server = require('../../server')

var app = new Server({
  nodeId: 'server',
  subprotocol: '1.0.0',
  supports: '1.x'
})

app.auth(function () {
  return Promise.resolve(true)
})

app.listen(app.loadOptions(process, {
  port: '1338',
  host: '127.0.0.1'
}))
