#!/usr/bin/env node

var Server = require('../../server')

new Server({
  env: 'test',
  nodeId: 'server',
  subprotocol: [1, 0],
  supports: [1]
})

new Promise(function (resolve, reject) {
  setTimeout(function () {
    var error = new Error('Test Error')
    error.stack = error.stack.split('\n')[0] + '\nfake stacktrace'
    reject(error)
  }, 10)
})
