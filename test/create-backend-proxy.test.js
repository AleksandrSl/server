const TestTime = require('logux-core').TestTime
const TestPair = require('logux-core').TestPair
const delay = require('nanodelay')
const http = require('http')

const ServerClient = require('../server-client')
const BaseServer = require('../base-server')

let destroyable = []
let lastPort = 8111

const OPTIONS = {
  backend: {
    password: '1234',
    url: 'http://127.0.0.1:8110/path'
  }
}

const ACTION = [
  'action', { type: 'A' }, { id: '1 server:rails 0', reasons: ['test'] }
]

function createConnection () {
  const pair = new TestPair()
  pair.left.ws = {
    _socket: {
      remoteAddress: '127.0.0.1'
    }
  }
  return pair.left
}

function createClient (server) {
  server.lastClient += 1
  const client = new ServerClient(server, createConnection(), server.lastClient)
  server.clients[server.lastClient] = client
  destroyable.push(client)
  return client
}

function connectClient (server) {
  const client = createClient(server)
  client.node.now = () => 0
  return client.connection.connect().then(() => {
    const protocol = client.node.localProtocol
    client.connection.other().send(['connect', protocol, '10:uuid', 0])
    return client.connection.pair.wait('right')
  }).then(() => {
    return client
  })
}

function createServer (options) {
  lastPort += 2
  options.time = new TestTime()
  options.port = lastPort
  options.subprotocol = '0.0.0'
  options.supports = '0.x'
  options.backend.port = lastPort + 1

  const server = new BaseServer(options)
  server.nodeId = 'server:uuid'
  server.auth(() => true)
  server.log.on('preadd', (action, meta) => {
    meta.reasons.push('test')
  })

  destroyable.push(server)

  return server
}

function request ({ method, path, string, data }) {
  if (!string && data) string = JSON.stringify(data)
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: method || 'POST',
      host: '127.0.0.1',
      port: lastPort + 1,
      path: path || '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(string)
      }
    }, res => {
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end(string)
  })
}

function send (data) {
  return request({ data })
}

let sent = []

const httpServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', data => {
    body += data
  })
  req.on('end', () => {
    const data = JSON.parse(body)
    sent.push([req.method, req.url, data])
    if (data.commands[0][1].type === 'NO') {
      res.statusCode = 404
      res.end()
    } else if (data.commands[0][1].type === 'BAD') {
      res.write(JSON.stringify([['forbidden']]))
      res.end()
    } else if (data.commands[0][1].type === 'ERROR') {
      res.write('[[')
      res.end()
    } else {
      res.write(JSON.stringify([['approved']]))
      delay(100).then(() => {
        res.write(JSON.stringify([['processed']]))
        res.end()
      })
    }
  })
})

beforeAll(() => {
  return new Promise((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(8110, resolve)
  })
})

beforeEach(() => {
  sent = []
})

afterEach(() => {
  return Promise.all(destroyable.map(i => i.destroy())).then(() => {
    destroyable = []
  })
})

afterAll(() => {
  return new Promise(resolve => {
    httpServer.close(resolve)
  })
})

it('checks password option', () => {
  expect(() => {
    createServer({ backend: { url: 'http://example.com' } })
  }).toThrowError(
    'For security reasons you must set strong password ' +
    'in `backend.password` option'
  )
})

it('checks url option', () => {
  expect(() => {
    createServer({ backend: { password: '123' } })
  }).toThrowError('You must set `backend.url` option with address to backend')
})

it('validates HTTP requests', () => {
  const app = createServer(OPTIONS)
  return app.listen().then(() => {
    return Promise.all([
      request({ method: 'GET', string: '' }),
      request({ path: '/logux', string: '' }),
      request({ string: '{' }),
      request({ string: '""' }),
      send({ }),
      send({ version: 100, password: '1234', commands: [] }),
      send({ version: 0, commands: [] }),
      send({ version: 0, password: '1234', commands: {} }),
      send({ version: 0, password: '1234', commands: [1] }),
      send({ version: 0, password: '1234', commands: [[1]] }),
      send({ version: 0, password: '1234', commands: [['f']] }),
      send({ version: 0, password: '1234', commands: [['action'], 'f']
      }),
      send({ version: 0, password: '1234', commands: [['action', { }, 'f']] }),
      send({ version: 0, password: 'wrong', commands: [] })
    ])
  }).then(codes => {
    expect(codes).toEqual([
      405, 404, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 403
    ])
    expect(app.log.actions()).toEqual([])
  })
})

it('creates actions', () => {
  const app = createServer(OPTIONS)
  return app.listen().then(() => {
    return send({ version: 0, password: '1234', commands: [ACTION] })
  }).then(code => {
    expect(code).toEqual(200)
    expect(app.log.actions()).toEqual([{ type: 'A' }])
    expect(sent).toEqual([])
  })
})

it('creates and processes actions', () => {
  const app = createServer(OPTIONS)
  let processed = 0
  app.type('A', {
    access: () => true,
    process () {
      processed += 1
    }
  })
  return app.listen().then(() => {
    return send({ version: 0, password: '1234', commands: [ACTION] })
  }).then(code => {
    expect(code).toEqual(200)
    expect(app.log.actions()).toEqual([{ type: 'A' }])
    expect(app.log.entries()[0][1].backend).toEqual('127.0.0.1')
    expect(sent).toEqual([])
    expect(processed).toEqual(1)
  })
})

it('reports about network errors', () => {
  const app = createServer({
    backend: {
      password: '1234',
      url: 'https://127.0.0.1:7110/'
    }
  })
  const errors = []
  app.on('error', e => {
    errors.push(e.code)
  })
  return connectClient(app).then(client => {
    client.connection.other().send(['sync', 1,
      { type: 'A' }, { id: [1, '10:uuid', 0], time: 1 }
    ])
    return delay(100)
  }).then(() => {
    expect(errors).toEqual(['ECONNREFUSED'])
    expect(app.log.actions()).toEqual([
      { type: 'logux/undo', reason: 'error', id: '1 10:uuid 0' }
    ])
  })
})

it('reports bad HTTP answers', () => {
  const app = createServer(OPTIONS)
  const errors = []
  app.on('error', e => {
    errors.push(e.message)
  })
  return connectClient(app).then(client => {
    client.connection.other().send(['sync', 1,
      { type: 'NO' }, { id: [1, '10:uuid', 0], time: 1 }
    ])
    return delay(100)
  }).then(() => {
    expect(errors).toEqual(['Backend responsed with 404 code'])
    expect(app.log.actions()).toEqual([
      { type: 'logux/undo', reason: 'error', id: '1 10:uuid 0' }
    ])
  })
})

it('notifies about actions and subscriptions', () => {
  const app = createServer(OPTIONS)
  app.on('error', e => {
    throw e
  })
  return connectClient(app).then(client => {
    client.connection.other().send(['sync', 2,
      { type: 'A' },
      { id: [1, '10:uuid', 0], time: 1 },
      { type: 'logux/subscribe', channel: 'a' },
      { id: [2, '10:uuid', 0], time: 2 }
    ])
    return client.connection.pair.wait('right')
  }).then(() => {
    expect(app.log.actions()).toEqual([
      { type: 'A' },
      { type: 'logux/subscribe', channel: 'a' }
    ])
    expect(app.log.entries()[0][1].status).toEqual('waiting')
    expect(sent).toEqual([
      [
        'POST',
        '/path',
        {
          version: 0,
          password: '1234',
          commands: [
            [
              'action',
              { type: 'A' },
              { id: '1 10:uuid 0', time: 1 }
            ]
          ]
        }
      ],
      [
        'POST',
        '/path',
        {
          version: 0,
          password: '1234',
          commands: [
            [
              'action',
              { type: 'logux/subscribe', channel: 'a' },
              {
                added: 1,
                id: '2 10:uuid 0',
                time: 2,
                reasons: ['test'],
                server: 'server:uuid',
                subprotocol: '0.0.0'
              }
            ]
          ]
        }
      ]
    ])
    return delay(150)
  }).then(() => {
    expect(app.log.actions()).toEqual([
      { type: 'A' },
      { type: 'logux/processed', id: '1 10:uuid 0' },
      { type: 'logux/subscribe', channel: 'a' },
      { type: 'logux/processed', id: '2 10:uuid 0' }
    ])
    expect(app.log.entries()[0][1].status).toEqual('processed')
  })
})

it('asks about action access', () => {
  const app = createServer(OPTIONS)
  app.on('error', e => {
    throw e
  })
  return connectClient(app).then(client => {
    client.connection.other().send(['sync', 2,
      { type: 'BAD' }, { id: [1, '10:uuid', 0], time: 1 }
    ])
    return client.connection.pair.wait('right')
  }).then(() => {
    expect(app.log.actions()).toEqual([
      { type: 'logux/undo', reason: 'denied', id: '1 10:uuid 0' }
    ])
  })
})

it('reacts on backend errors', () => {
  const app = createServer(OPTIONS)
  let error
  app.on('error', e => {
    error = e
  })
  return connectClient(app).then(client => {
    client.connection.other().send(['sync', 2,
      { type: 'ERROR' }, { id: [1, '10:uuid', 0], time: 1 }
    ])
    return client.connection.pair.wait('right')
  }).then(() => {
    expect(app.log.actions()).toEqual([
      { type: 'logux/undo', reason: 'error', id: '1 10:uuid 0' }
    ])
    expect(error.message).toEqual('Backend error with response "[["')
  })
})
