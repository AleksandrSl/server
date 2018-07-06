const https = require('https')
const http = require('http')
const url = require('url')

const VERSION = 0
const MIN_VERSION = 0

const FORBIDDEN = /^\[\s*\[\s*"forbidden"/
const APPROVED = /^\[\s*\[\s*"approved"/

function isValid (data) {
  if (typeof data !== 'object') return false
  if (typeof data.version !== 'number') return false
  if (data.version > MIN_VERSION) return false
  if (typeof data.password !== 'string') return false
  if (!Array.isArray(data.commands)) return false
  for (const command of data.commands) {
    if (!Array.isArray(command)) return false
    if (command[0] !== 'action') return false
    if (typeof command[1] !== 'object') return false
    if (typeof command[2] !== 'object') return false
  }
  return true
}

function waitForEnd (res) {
  return new Promise(resolve => {
    res.on('end', resolve)
  })
}

function createBackendProxy (server, options) {
  if (!options.password) {
    throw new Error(
      'For security reasons you must set strong password ' +
      'in `backend.password` option'
    )
  }
  if (!options.url) {
    throw new Error('You must set `backend.url` option with address to backend')
  }

  const backend = url.parse(options.url)

  const processing = []

  function send (ctx, action, meta) {
    const body = JSON.stringify({
      version: VERSION,
      password: options.password,
      commands: [['action', action, meta]]
    })
    const protocol = backend.protocol === 'https:' ? https : http
    return new Promise((resolve, reject) => {
      const req = protocol.request({
        method: 'POST',
        host: backend.hostname,
        port: backend.port,
        path: backend.path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        let received = ''
        let answer = false
        if (res.statusCode < 200 || res.statusCode > 299) {
          reject(
            new Error('Backend responsed with ' + res.statusCode + ' code'))
        } else {
          processing[meta.id] = waitForEnd(res)
          res.on('data', part => {
            if (!answer) {
              received += part
              if (APPROVED.test(received)) {
                answer = true
                resolve(true)
              } else if (FORBIDDEN.test(received)) {
                answer = true
                delete processing[meta.id]
                resolve(false)
              }
            }
          })
        }
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  function process (ctx, action, meta) {
    return processing[meta.id].then(() => {
      delete processing[meta.id]
    })
  }

  server.otherType({
    access: send,
    process
  })

  server.otherChannel({
    access: send,
    init: process
  })

  const httpServer = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    if (req.url !== '/') {
      res.statusCode = 404
      res.end()
      return
    }

    let body = ''
    req.on('data', data => {
      body += data
    })
    req.on('end', () => {
      let data
      try {
        data = JSON.parse(body)
      } catch (e) {
        res.statusCode = 400
        res.end()
        return
      }
      if (!isValid(data)) {
        res.statusCode = 400
        res.end()
        return
      }
      if (data.password !== options.password) {
        res.statusCode = 403
        res.end()
        return
      }
      Promise.all(data.commands.map(command => {
        if (!server.types[command[1].type]) {
          command[2].status = 'processed'
        }
        return server.log.add(command[1], command[2])
      })).then(() => {
        res.end()
      })
    })
  })

  server.unbind.push(() => {
    return new Promise(resolve => {
      httpServer.close(resolve)
    })
  })

  return httpServer
}

module.exports = createBackendProxy
