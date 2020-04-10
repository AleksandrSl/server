let { ClientNode, Log, MemoryStore, WsConnection } = require('@logux/core')
let { delay } = require('nanodelay')
let WebSocket = require('ws')
let http = require('http')

let BaseServer = require('../base-server')

let lastPort = 10111
function createServer (opts = { }) {
  lastPort += 1
  let server = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x',
    port: lastPort,
    ...opts
  })
  server.auth(() => true)
  return server
}

function createReporter (opts) {
  let result = { }
  result.names = []
  result.reports = []

  opts = opts || { }
  opts.reporter = (name, details) => {
    result.names.push(name)
    result.reports.push([name, details])
  }

  app = createServer(opts)
  result.app = app
  return result
}

function request (method, path) {
  return new Promise((resolve, reject) => {
    let req = http.request({
      method,
      host: 'localhost',
      port: app.options.port,
      path
    }, res => {
      let body = ''
      res.on('data', chunk => {
        body += chunk
      })
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ body, headers: res.headers })
        } else {
          let error = new Error(body)
          error.statusCode = res.statusCode
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function requestError (method, path) {
  try {
    await request(method, path)
    return false
  } catch (e) {
    return e
  }
}

let app

afterEach(async () => {
  await app.destroy()
  app = undefined
})

it('has health check', async () => {
  app = createServer({ controlSecret: 'secret', backend: 'http://localhost/' })
  await app.listen()
  let response = await request('GET', '/')
  expect(response.body).toEqual('OK')
})

it('responses 404', async () => {
  app = createServer()
  await app.listen()
  let err = await requestError('GET', '/unknown')
  expect(err.statusCode).toEqual(404)
  expect(err.message).toEqual('Wrong path')
})

it('checks secret', async () => {
  let test = createReporter({ controlSecret: 'secret' })
  test.app.controls['GET /test'] = {
    request: () => ({ body: 'done' })
  }
  await test.app.listen()

  let response = await request('GET', '/test%3Fsecret')
  expect(response.body).toContain('done')

  let err = await requestError('GET', '/test?wrong')
  expect(err.statusCode).toEqual(403)
  expect(err.message).toEqual('Wrong secret')

  expect(test.reports[1]).toEqual([
    'wrongControlSecret', { ipAddress: '127.0.0.1', wrongSecret: 'wrong' }
  ])
})

it('supports wrong URL encoding', async () => {
  app = createServer({ controlSecret: 'secret' })
  app.controls['GET /test'] = {
    request: () => ({ body: 'done' })
  }
  await app.listen()
  let response = await request('GET', '/test%3Fsecret')

  expect(response.body).toContain('done')
})

it('shows error on missed secret', async () => {
  app = createServer({ controlSecret: undefined })
  app.controls['GET /test'] = {
    request: () => ({ body: 'done' })
  }
  await app.listen()
  let err = await requestError('GET', '/test?secret')
  expect(err.statusCode).toEqual(500)
  expect(err.message).toContain('LOGUX_CONTROL_SECRET')
})

it('passes headers', async () => {
  app = createServer({ controlSecret: 'secret' })
  app.controls['GET /test'] = {
    request: () => ({
      headers: {
        'Content-Type': 'text/plain'
      },
      body: 'done'
    })
  }
  await app.listen()
  let response = await request('GET', '/test%3Fsecret')

  expect(response.headers['content-type']).toContain('text/plain')
})

it('has bruteforce protection', async () => {
  app = createServer({ controlSecret: 'secret' })
  app.controls['GET /test'] = {
    request: () => ({ body: 'done' })
  }
  await app.listen()

  let err1 = await requestError('GET', '/test?wrong')
  expect(err1.statusCode).toEqual(403)

  let err2 = await requestError('GET', '/test?wrong')
  expect(err2.statusCode).toEqual(403)

  let err3 = await requestError('GET', '/test?wrong')
  expect(err3.statusCode).toEqual(403)

  let err4 = await requestError('GET', '/test?wrong')
  expect(err4.statusCode).toEqual(429)

  await delay(3050)

  let err5 = await requestError('GET', '/test?wrong')
  expect(err5.statusCode).toEqual(403)
})

it('does not break WebSocket', async () => {
  app = createServer({
    controlSecret: 'secret',
    controlMask: '128.0.0.1/8, 127.1.0.0/16'
  })
  await app.listen()

  let nodeId = '10:client:node'
  let log = new Log({ store: new MemoryStore(), nodeId })
  let con = new WsConnection('ws://localhost:' + app.options.port, WebSocket)
  let node = new ClientNode(nodeId, log, con)

  node.connection.connect()
  await node.waitFor('synchronized')
})

it('checks incoming IP address', async () => {
  let controlMask = '128.0.0.1/8, 127.1.0.0/16'
  let test = createReporter({ controlMask })
  await test.app.listen()
  let err = await requestError('GET', '/')

  expect(err.statusCode).toEqual(403)
  expect(err.message).toContain('LOGUX_CONTROL_MASK')
  expect(test.reports[1]).toEqual([
    'wrongControlIp', { ipAddress: '127.0.0.1', mask: controlMask }
  ])
})
