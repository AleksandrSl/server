const MemoryStore = require('logux-core').MemoryStore
const WebSocket = require('ws')
const TestTime = require('logux-core').TestTime
const delay = require('nanodelay')
const https = require('https')
const http = require('http')
const path = require('path')
const Log = require('logux-core').Log
const fs = require('fs')

const BaseServer = require('../base-server')
const promisify = require('../promisify')
const pkg = require('../package.json')

const DEFAULT_OPTIONS = {
  subprotocol: '0.0.0',
  supports: '0.x'
}
const CERT = path.join(__dirname, 'fixtures/cert.pem')
const KEY = path.join(__dirname, 'fixtures/key.pem')

let lastPort = 9111
function createServer (options) {
  if (!options) options = { }
  for (const i in DEFAULT_OPTIONS) {
    if (typeof options[i] === 'undefined') {
      options[i] = DEFAULT_OPTIONS[i]
    }
  }
  if (typeof options.port === 'undefined') {
    lastPort += 1
    options.port = lastPort
  }

  const created = new BaseServer(options)
  created.nodeId = 'server:uuid'
  created.auth(() => true)
  let lastId = 0
  created.log.generateId = () => [++lastId, 'server:uuid', 0]

  return created
}

let app, server

function createReporter (opts) {
  const result = { }
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

const originEnv = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = originEnv
  return Promise.all([
    app ? app.destroy() : true,
    server ? promisify(done => server.close(done)) : true
  ]).then(() => {
    app = undefined
    server = undefined
  })
})

it('saves server options', () => {
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x'
  })
  expect(app.options.supports).toEqual('0.x')
})

it('generates node ID', () => {
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x'
  })
  expect(app.nodeId).toMatch(/server:[\w\d~_]+/)
})

it('throws on missed subprotocol', () => {
  expect(() => {
    new BaseServer({ })
  }).toThrowError(/Missed `subprotocol` option/)
})

it('throws on missed supported subprotocols', () => {
  expect(() => {
    new BaseServer({ subprotocol: '0.0.0' })
  }).toThrowError(/Missed `supports` option/)
})

it('sets development environment by default', () => {
  delete process.env.NODE_ENV
  app = new BaseServer(DEFAULT_OPTIONS)
  expect(app.env).toEqual('development')
})

it('takes environment from NODE_ENV', () => {
  process.env.NODE_ENV = 'production'
  app = new BaseServer(DEFAULT_OPTIONS)
  expect(app.env).toEqual('production')
})

it('sets environment from user', () => {
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x',
    env: 'production'
  })
  expect(app.env).toEqual('production')
})

it('uses cwd as default root', () => {
  app = new BaseServer(DEFAULT_OPTIONS)
  expect(app.options.root).toEqual(process.cwd())
})

it('uses user root', () => {
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x',
    root: '/a'
  })
  expect(app.options.root).toEqual('/a')
})

it('creates log with default store', () => {
  app = new BaseServer(DEFAULT_OPTIONS)
  expect(app.log instanceof Log).toBeTruthy()
  expect(app.log.store instanceof MemoryStore).toBeTruthy()
})

it('creates log with custom store', () => {
  const store = new MemoryStore()
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x',
    store
  })
  expect(app.log.store).toBe(store)
})

it('uses test time and ID', () => {
  const store = new MemoryStore()
  app = new BaseServer({
    subprotocol: '0.0.0',
    supports: '0.x',
    store,
    time: new TestTime(),
    id: 'uuid'
  })
  expect(app.log.store).toEqual(store)
  expect(app.log.generateId()).toEqual([1, 'server:uuid', 0])
})

it('destroys application without runned server', () => {
  app = new BaseServer(DEFAULT_OPTIONS)
  return app.destroy().then(() => app.destroy())
})

it('throws without authenticator', () => {
  app = new BaseServer(DEFAULT_OPTIONS)
  expect(() => {
    app.listen()
  }).toThrowError(/authentication/)
})

it('uses 1337 port by default', () => {
  app = createServer()
  expect(app.options.port).toEqual(1337)
})

it('uses user port', () => {
  app = createServer({ port: 31337 })
  expect(app.options.port).toEqual(31337)
})

it('uses 127.0.0.1 to bind server by default', () => {
  app = createServer()
  expect(app.options.host).toEqual('127.0.0.1')
})

it('throws a error on key without certificate', () => {
  expect(() => {
    app = createServer({ key: fs.readFileSync(KEY) })
  }).toThrowError(/set `cert` option/)
})

it('throws a error on certificate without key', () => {
  expect(() => {
    app = createServer({ cert: fs.readFileSync(CERT) })
  }).toThrowError(/set `key` option/)
})

it('uses HTTPS', () => {
  app = createServer({
    cert: fs.readFileSync(CERT),
    key: fs.readFileSync(KEY)
  })
  return app.listen().then(() => {
    expect(app.http instanceof https.Server).toBeTruthy()
  })
})

it('loads keys by absolute path', () => {
  app = createServer({
    cert: CERT,
    key: KEY
  })
  return app.listen().then(() => {
    expect(app.http instanceof https.Server).toBeTruthy()
  })
})

it('loads keys by relative path', () => {
  app = createServer({
    root: __dirname,
    cert: 'fixtures/cert.pem',
    key: 'fixtures/key.pem'
  })
  return app.listen().then(() => {
    expect(app.http instanceof https.Server).toBeTruthy()
  })
})

it('supports object in SSL key', () => {
  app = createServer({
    cert: fs.readFileSync(CERT),
    key: { pem: fs.readFileSync(KEY) }
  })
  return app.listen().then(() => {
    expect(app.http instanceof https.Server).toBeTruthy()
  })
})

it('reporters on start listening', () => {
  const test = createReporter()

  const promise = test.app.listen()
  expect(test.reports).toEqual([])

  return promise.then(() => {
    expect(test.reports).toEqual([
      ['listen', {
        loguxServer: pkg.version,
        environment: 'test',
        nodeId: 'server:uuid',
        subprotocol: '0.0.0',
        supports: '0.x',
        server: false,
        cert: false,
        host: '127.0.0.1',
        port: test.app.options.port
      }]
    ])
  })
})

it('reporters on log events', () => {
  const test = createReporter()
  test.app.type('A', { access: () => true })
  test.app.log.add({ type: 'A' })
  expect(test.reports).toEqual([
    ['add', {
      action: {
        type: 'A'
      },
      meta: {
        id: [1, 'server:uuid', 0],
        reasons: [],
        status: 'waiting',
        server: 'server:uuid',
        subprotocol: '0.0.0',
        time: 1
      }
    }],
    ['clean', {
      actionId: [1, 'server:uuid', 0]
    }]
  ])
})

it('reporters on destroying', () => {
  const test = createReporter()
  const promise = test.app.destroy()
  expect(test.reports).toEqual([['destroy', undefined]])
  return promise
})

it('creates a client on connection', () => {
  app = createServer()
  return app.listen().then(() => {
    const ws = new WebSocket(`ws://127.0.0.1:${ app.options.port }`)
    return new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
  }).then(() => {
    expect(Object.keys(app.clients)).toHaveLength(1)
    expect(app.clients[1].remoteAddress).toEqual('127.0.0.1')
  })
})

it('creates a client manually', () => {
  app = createServer()
  app.addClient({
    on: () => {
      return () => true
    },
    ws: {
      _socket: {
        remoteAddress: '127.0.0.1'
      }
    }
  })
  expect(Object.keys(app.clients)).toHaveLength(1)
  expect(app.clients[1].remoteAddress).toEqual('127.0.0.1')
})

it('send debug message to clients on runtimeError', () => {
  app = createServer()
  app.clients[1] = { connection: { send: jest.fn() }, destroy: () => false }

  const error = new Error('Test Error')
  error.stack = `${ error.stack.split('\n')[0] }\nfake stacktrace`

  app.debugError(error)
  expect(app.clients[1].connection.send).toBeCalledWith([
    'debug',
    'error',
    'Error: Test Error\n' +
    'fake stacktrace'
  ])
})

it('disconnects client on destroy', () => {
  app = createServer()
  app.clients[1] = { destroy: jest.fn() }
  app.destroy()
  expect(app.clients[1].destroy).toBeCalled()
})

it('accepts custom HTTP server', () => {
  server = http.createServer()
  app = createServer({ server })

  return promisify(done => {
    server.listen(app.options.port, done)
  }).then(() => app.listen()).then(() => {
    const ws = new WebSocket(`ws://localhost:${ app.options.port }`)
    return new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
  }).then(() => {
    expect(Object.keys(app.clients)).toHaveLength(1)
  })
})

it('marks actions with own node ID', () => {
  app = createServer()
  app.type('A', { access: () => true })

  const servers = []
  app.log.on('add', (action, meta) => {
    servers.push(meta.server)
  })

  return Promise.all([
    app.log.add({ type: 'A' }),
    app.log.add({ type: 'A' }, { server: 'server2' })
  ]).then(() => {
    expect(servers).toEqual([app.nodeId, 'server2'])
  })
})

it('marks actions with waiting status', () => {
  app = createServer()
  app.type('A', { access: () => true })
  app.channel('a', { access: () => true })

  const statuses = []
  app.log.on('add', (action, meta) => {
    statuses.push(meta.status)
  })

  return Promise.all([
    app.log.add({ type: 'A' }),
    app.log.add({ type: 'A' }, { status: 'processed' }),
    app.log.add({ type: 'logux/subscribe', channel: 'a' })
  ]).then(() => {
    expect(statuses).toEqual(['waiting', 'processed', undefined])
  })
})

it('defines actions types', () => {
  app = createServer()
  app.type('FOO', { access: () => true })
  expect(app.types.FOO).not.toBeUndefined()
})

it('does not allow to define type twice', () => {
  app = createServer()
  app.type('FOO', { access: () => true })
  expect(() => {
    app.type('FOO', { access: () => true })
  }).toThrowError(/already/)
})

it('requires access callback for type', () => {
  app = createServer()
  expect(() => {
    app.type('FOO')
  }).toThrowError(/access callback/)
})

it('reports about unknown action type', () => {
  const test = createReporter()
  return test.app.log.add(
    { type: 'UNKNOWN' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    expect(test.names).toEqual(['add', 'unknownType', 'add', 'clean', 'clean'])
    expect(test.reports[1]).toEqual(['unknownType', {
      actionId: [1, '10:uuid', 0],
      type: 'UNKNOWN'
    }])
  })
})

it('ignores unknown type for processed actions', () => {
  const test = createReporter()
  return test.app.log.add({ type: 'A' }, { status: 'processed' }).then(() => {
    expect(test.names).toEqual(['add', 'clean'])
  })
})

it('sends errors to clients in development', () => {
  const test = createReporter({ env: 'development' })
  test.app.clients[0] = {
    connection: { send: jest.fn() },
    destroy: () => false
  }

  const err = new Error('Test')
  err.stack = 'stack'
  test.app.emitter.emit('error', err)

  expect(test.reports).toEqual([['error', { err, fatal: true }]])
  expect(test.app.clients[0].connection.send).toHaveBeenCalledWith(
    ['debug', 'error', 'stack']
  )
})

it('does not send errors in non-development mode', () => {
  app = createServer({ env: 'production' })
  app.clients[0] = {
    connection: { send: jest.fn() },
    destroy: () => false
  }
  app.emitter.emit('error', new Error('Test'))
  expect(app.clients[0].connection.send).not.toHaveBeenCalled()
})

it('processes actions', () => {
  const test = createReporter()
  const processed = []
  const fired = []

  test.app.type('FOO', {
    access: () => true,
    process (action, meta, creator) {
      expect(meta.added).toEqual(1)
      expect(creator.isServer).toBeTruthy()
      return delay(25).then(() => {
        processed.push(action)
      })
    }
  })
  test.app.on('processed', (action, meta) => {
    expect(meta.added).toEqual(1)
    fired.push(action)
  })

  return test.app.log.add({ type: 'FOO' }, { reasons: ['test'] })
    .then(() => Promise.resolve())
    .then(() => {
      expect(fired).toEqual([])
      return delay(30)
    }).then(() => {
      expect(processed).toEqual([{ type: 'FOO' }])
      expect(fired).toEqual([{ type: 'FOO' }])
      expect(test.names).toEqual(['add', 'processed'])
      expect(Object.keys(test.reports[1][1])).toEqual(['actionId', 'latency'])
      expect(test.reports[1][1].actionId).toEqual([1, 'server:uuid', 0])
      expect(test.reports[1][1].latency).toBeCloseTo(25, -2)
    })
})

it('has full events API', () => {
  app = createServer()

  let events = 0
  const unbind = app.on('processed', () => {
    events += 1
  })

  app.emitter.emit('processed')
  app.emitter.emit('processed')
  unbind()
  app.emitter.emit('processed')

  expect(events).toEqual(2)
})

it('waits for last processing before destroy', () => {
  app = createServer()

  let started = 0
  let process

  app.type('FOO', {
    access: () => true,
    process () {
      started += 1
      return new Promise(resolve => {
        process = resolve
      })
    }
  })

  let destroyed = false
  return app.log.add({ type: 'FOO' }).then(() => {
    app.destroy().then(() => {
      destroyed = true
    })
    return Promise.resolve()
  }).then(() => {
    expect(destroyed).toBeFalsy()
    expect(app.processing).toEqual(1)
    return app.log.add({ type: 'FOO' })
  }).then(() => {
    expect(started).toEqual(1)
    process()
    return delay(1)
  }).then(() => {
    expect(destroyed).toBeTruthy()
  })
})

it('reports about error during action processing', () => {
  const test = createReporter()

  const err = new Error('Test')
  app.type('FOO', {
    access: () => true,
    process () {
      throw err
    }
  })

  return app.log.add({ type: 'FOO' }, { reasons: ['test'] }).then(() => {
    return delay(1)
  }).then(() => {
    expect(test.names).toEqual(['add', 'error', 'add'])
    expect(test.reports[1]).toEqual(['error', {
      actionId: [1, 'server:uuid', 0],
      err
    }])
    expect(test.reports[2][1].action).toEqual({
      type: 'logux/undo', reason: 'error', id: [1, 'server:uuid', 0]
    })
  })
})

it('undos actions on client', () => {
  app = createServer()
  app.undo({
    id: [1, '1:uuid', 0],
    users: ['3'],
    reasons: ['user/1/lastValue'],
    nodeIds: ['2:uuid'],
    channels: ['user/1']
  }, 'magic')
  return Promise.resolve().then(() => {
    const entries = app.log.store.created.map(i => i.slice(0, 2))
    expect(entries).toEqual([
      [
        {
          id: [1, '1:uuid', 0],
          type: 'logux/undo',
          reason: 'magic'
        },
        {
          id: [1, 'server:uuid', 0],
          time: 1,
          added: 1,
          users: ['3'],
          server: 'server:uuid',
          status: 'processed',
          nodeIds: ['1:uuid', '2:uuid'],
          reasons: ['user/1/lastValue'],
          channels: ['user/1'],
          subprotocol: '0.0.0'
        }
      ]
    ])
  })
})

it('adds current subprotocol to meta', () => {
  app = createServer({ subprotocol: '1.0.0' })
  app.type('A', { access: () => true })
  return app.log.add({ type: 'A' }, { reasons: ['test'] }).then(() => {
    expect(app.log.store.created[0][1].subprotocol).toEqual('1.0.0')
  })
})

it('adds current subprotocol only to own actions', () => {
  app = createServer({ subprotocol: '1.0.0' })
  app.type('A', { access: () => true })
  return app.log.add(
    { type: 'A' },
    { id: [1, '0:other', 0], reasons: ['test'] }
  ).then(() => {
    expect(app.log.store.created[0][1].subprotocol).toBeUndefined()
  })
})

it('allows to override subprotocol in meta', () => {
  app = createServer({ subprotocol: '1.0.0' })
  app.type('A', { access: () => true })
  return app.log.add(
    { type: 'A' },
    { subprotocol: '0.1.0', reasons: ['test'] }
  ).then(() => {
    expect(app.log.store.created[0][1].subprotocol).toEqual('0.1.0')
  })
})

it('reports about wrong channel name', () => {
  const test = createReporter({ env: 'development' })
  test.app.channel('foo', { access: () => true })
  test.app.nodeIds['10:uuid'] = {
    connection: { send: jest.fn() },
    sync: { onAdd () { } }
  }
  return test.app.log.add(
    { type: 'logux/subscribe' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    expect(test.names).toEqual([
      'add', 'wrongChannel', 'add', 'clean', 'clean'
    ])
    expect(test.reports[1][1]).toEqual({
      actionId: [1, '10:uuid', 0], channel: undefined
    })
    expect(test.reports[2][1].action).toEqual({
      id: [1, '10:uuid', 0], reason: 'error', type: 'logux/undo'
    })
    expect(test.app.nodeIds['10:uuid'].connection.send).toHaveBeenCalledWith([
      'debug', 'error', 'Wrong channel name undefined'
    ])
    return test.app.log.add({ type: 'logux/unsubscribe' })
  }).then(() => {
    expect(test.reports[6]).toEqual(['wrongChannel', {
      actionId: [2, 'server:uuid', 0], channel: undefined
    }])
    return test.app.log.add({ type: 'logux/subscribe', channel: 'unknown' })
  }).then(() => {
    expect(test.reports[11]).toEqual(['wrongChannel', {
      actionId: [4, 'server:uuid', 0], channel: 'unknown'
    }])
  })
})

it('allows to have custom channel name check', () => {
  const test = createReporter()
  const channels = []
  test.app.channel(/.*/, {
    access (params, action, meta) {
      channels.push(params[0])
      test.app.wrongChannel(action, meta)
    }
  })
  test.app.nodeIds['10:uuid'] = {
    connection: { send: jest.fn() },
    sync: { onAdd () { } }
  }
  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'foo' }
  ).then(() => {
    expect(channels).toEqual(['foo'])
    expect(test.names).toEqual([
      'add', 'wrongChannel', 'add', 'clean', 'clean'
    ])
  })
})

it('ignores subscription for other servers', () => {
  const test = createReporter()
  const action = { type: 'logux/subscribe' }
  return test.app.log.add(action, { server: 'server:other' }).then(() => {
    expect(test.names).toEqual(['add', 'clean'])
  })
})

it('checks channel access', () => {
  const test = createReporter()
  const client = {
    sync: { remoteSubprotocol: '0.0.0', onAdd: () => false }
  }
  test.app.nodeIds['10:uuid'] = client

  test.app.channel(/^user\/(\d+)$/, {
    access (params) {
      expect(params[1]).toEqual('10')
      return Promise.resolve(false)
    }
  })

  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'user/10' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(test.names).toEqual(['add', 'clean', 'denied', 'add', 'clean'])
    expect(test.reports[2][1]).toEqual({ actionId: [1, '10:uuid', 0] })
    expect(test.reports[3][1].action).toEqual({
      type: 'logux/undo', id: [1, '10:uuid', 0], reason: 'denied'
    })
    expect(test.app.subscribers).toEqual({ })
  })
})

it('reports about errors during channel authorization', () => {
  const test = createReporter()
  const client = {
    sync: { remoteSubprotocol: '0.0.0', onAdd: () => false }
  }
  test.app.nodeIds['10:uuid'] = client

  const err = new Error()
  test.app.channel(/^user\/(\d+)$/, {
    access () {
      throw err
    }
  })

  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'user/10' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    return Promise.resolve()
  }).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(test.names).toEqual(['add', 'clean', 'error', 'add', 'clean'])
    expect(test.reports[2][1]).toEqual({ actionId: [1, '10:uuid', 0], err })
    expect(test.reports[3][1].action).toEqual({
      type: 'logux/undo', id: [1, '10:uuid', 0], reason: 'error'
    })
    expect(test.app.subscribers).toEqual({ })
  })
})

it('subscribes clients', () => {
  const test = createReporter()
  const client = {
    sync: { remoteSubprotocol: '0.0.0', onAdd: () => false }
  }
  test.app.nodeIds['10:uuid'] = client

  let userSubsriptions = 0
  test.app.channel('user/:id', {
    access (params, action, meta, creator) {
      expect(params.id).toEqual('10')
      expect(action.channel).toEqual('user/10')
      expect(meta.id).toEqual([1, '10:uuid', 0])
      expect(creator.nodeId).toEqual('10:uuid')
      userSubsriptions += 1
      return true
    }
  })

  function filter () { }
  test.app.channel('posts', {
    access () {
      return true
    },
    filter () {
      return filter
    }
  })

  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'user/10' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(userSubsriptions).toEqual(1)
    expect(test.names).toEqual(['add', 'clean', 'subscribed', 'add', 'clean'])
    expect(test.reports[2][1]).toEqual({
      actionId: [1, '10:uuid', 0], channel: 'user/10'
    })
    expect(test.reports[3][1].action).toEqual({
      type: 'logux/processed', id: [1, '10:uuid', 0]
    })
    expect(test.reports[3][1].meta.nodeIds).toEqual(['10:uuid'])
    expect(test.reports[3][1].meta.status).toEqual('processed')
    expect(test.app.subscribers).toEqual({
      'user/10': {
        '10:uuid': true
      }
    })
    return test.app.log.add(
      { type: 'logux/subscribe', channel: 'posts' }, { id: [2, '10:uuid', 0] }
    )
  }).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(test.app.subscribers).toEqual({
      'user/10': {
        '10:uuid': true
      },
      'posts': {
        '10:uuid': filter
      }
    })
    return test.app.log.add(
      { type: 'logux/unsubscribe', channel: 'user/10' },
      { id: [3, '10:uuid', 0] }
    )
  }).then(() => {
    expect(test.names).toEqual([
      'add', 'clean', 'subscribed',
      'add', 'clean', 'add', 'clean', 'subscribed',
      'add', 'clean', 'add', 'unsubscribed', 'clean'
    ])
    expect(test.reports[11][1]).toEqual({
      actionId: [3, '10:uuid', 0], channel: 'user/10'
    })
    expect(test.app.subscribers).toEqual({
      'posts': {
        '10:uuid': filter
      }
    })
  })
})

it('reports about errors during channel initialization', () => {
  const test = createReporter()
  const client = {
    sync: { remoteSubprotocol: '0.0.0', onAdd: () => false }
  }
  test.app.nodeIds['10:uuid'] = client

  const err = new Error()
  test.app.channel(/^user\/(\d+)$/, {
    access: () => true,
    init () {
      throw err
    }
  })

  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'user/10' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    return Promise.resolve()
  }).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(test.names).toEqual([
      'add', 'clean', 'subscribed', 'error', 'add', 'clean', 'unsubscribed'
    ])
    expect(test.reports[3][1]).toEqual({ actionId: [1, '10:uuid', 0], err })
    expect(test.reports[4][1].action).toEqual({
      type: 'logux/undo', id: [1, '10:uuid', 0], reason: 'error'
    })
    expect(test.app.subscribers).toEqual({ })
  })
})

it('loads initial actions during subscription', () => {
  const test = createReporter()
  const client = {
    sync: { remoteSubprotocol: '0.0.0', onAdd: () => false }
  }
  test.app.nodeIds['10:uuid'] = client

  let userLoaded = 0
  let initializating
  test.app.channel('user/:id', {
    access: () => true,
    init (params, action, meta, creator) {
      expect(params.id).toEqual('10')
      expect(action.channel).toEqual('user/10')
      expect(meta.id).toEqual([1, '10:uuid', 0])
      expect(creator.nodeId).toEqual('10:uuid')
      userLoaded += 1
      return new Promise(resolve => {
        initializating = resolve
      })
    }
  })

  return test.app.log.add(
    { type: 'logux/subscribe', channel: 'user/10' }, { id: [1, '10:uuid', 0] }
  ).then(() => {
    return Promise.resolve()
  }).then(() => {
    expect(userLoaded).toEqual(1)
    expect(test.app.subscribers).toEqual({
      'user/10': {
        '10:uuid': true
      }
    })
    initializating()
  })
})

it('does not need type definition for own actions', () => {
  const test = createReporter()
  return test.app.log.add({ type: 'unknown' }).then(() => {
    expect(test.names).toEqual(['add', 'clean'])
    expect(test.reports[0][1].action.type).toEqual('unknown')
    expect(test.reports[0][1].meta.status).toEqual('processed')
  })
})

it('checks callbacks in unknown type handler', () => {
  app = createServer()

  expect(() => {
    app.otherType({ process: () => true })
  }).toThrowError(/Unknown type must have access callback/)

  app.otherType({ access: () => true })
  expect(() => {
    app.otherType({ access: () => true })
  }).toThrowError(/Callbacks for unknown types are already defined/)
})
