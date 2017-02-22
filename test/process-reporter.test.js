var processReporter = require('../reporters/human/process')
var common = require('../reporters/human/common')

var ServerConnection = require('logux-sync').ServerConnection
var createServer = require('http').createServer
var SyncError = require('logux-sync').SyncError
var yyyymmdd = require('yyyy-mm-dd')
var path = require('path')

var BaseServer = require('../base-server')
var Client = require('../client')

function reportersOut () {
  return processReporter.apply({}, arguments)
    .replace(/\r\v/g, '\n')
    .replace(yyyymmdd.withTime(new Date(1487805099387)), '2017-02-22 23:11:39')
}

var app = new BaseServer({
  env: 'development',
  pid: 21384,
  nodeId: 'server:H1f8LAyzl',
  subprotocol: '2.5.0',
  supports: '2.x || 1.x'
})
app.listenOptions = { host: '127.0.0.1', port: 1337 }

var ws = {
  upgradeReq: {
    headers: { },
    connection: {
      remoteAddress: '127.0.0.1'
    }
  },
  on: () => { }
}

var authed = new Client(app, new ServerConnection(ws), 1)
authed.sync.remoteSubprotocol = '1.0.0'
authed.sync.remoteProtocol = [0, 0]
authed.id = '100'
authed.user = { }
authed.nodeId = '100:H10Nf5stl'

var noUserId = new Client(app, new ServerConnection(ws), 1)
noUserId.sync.remoteSubprotocol = '1.0.0'
noUserId.sync.remoteProtocol = [0, 0]
noUserId.user = { }
noUserId.nodeId = 'H10Nf5stl'

var unauthed = new Client(app, new ServerConnection(ws), 1)

var ownError = new SyncError(authed.sync, 'timeout', 5000, false)
var clientError = new SyncError(authed.sync, 'timeout', 5000, true)

var originNow = common.now
beforeAll(() => {
  common.now = () => new Date((new Date()).getTimezoneOffset() * 60000)
})
afterAll(() => {
  common.now = originNow
})

var action = {
  type: 'CHANGE_USER',
  id: 100,
  data: { name: 'John' }
}
var meta = {
  id: [1487805099387, authed.nodeId, 0],
  time: 1487805099387,
  reasons: ['lastValue', 'debug'],
  user: authed.nodeId,
  server: 'server:H1f8LAyzl'
}

it('reports listen', () => {
  expect(reportersOut('listen', app)).toMatchSnapshot()
})

it('reports production', () => {
  var wss = new BaseServer({
    env: 'production',
    pid: 21384,
    nodeId: 'server:H1f8LAyzl',
    subprotocol: '1.0.0',
    supports: '1.x'
  })
  wss.listenOptions = { cert: 'A', host: '0.0.0.0', port: 1337 }

  expect(reportersOut('listen', wss)).toMatchSnapshot()
})

it('reports http', () => {
  var http = new BaseServer({
    env: 'development',
    pid: 21384,
    nodeId: 'server:H1f8LAyzl',
    subprotocol: '1.0.0',
    supports: '1.x'
  })
  http.listenOptions = { server: createServer() }

  expect(reportersOut('listen', http)).toMatchSnapshot()
})

it('reports connect', () => {
  expect(reportersOut('connect', app, authed)).toMatchSnapshot()
})

it('reports authenticated', () => {
  expect(reportersOut('authenticated', app, authed)).toMatchSnapshot()
})

it('reports authenticated without user ID', () => {
  expect(reportersOut('authenticated', app, noUserId)).toMatchSnapshot()
})

it('reports bad authenticated', () => {
  expect(reportersOut('unauthenticated', app, authed)).toMatchSnapshot()
})

it('reports action', () => {
  expect(reportersOut('add', app, action, meta)).toMatchSnapshot()
})

it('reports clean', () => {
  expect(reportersOut('clean', app, action, meta)).toMatchSnapshot()
})

it('reports disconnect', () => {
  expect(reportersOut('disconnect', app, authed)).toMatchSnapshot()
})

it('reports disconnect from unauthenticated user', () => {
  expect(reportersOut('disconnect', app, unauthed)).toMatchSnapshot()
})

it('reports error', () => {
  var file = __filename
  var jest = path.join(__dirname, '..', 'node_modules', 'jest', 'index.js')
  var error = new Error('Some mistake')
  var errorStack = [
    `${ error.name }: ${ error.message }`,
    `    at Object.<anonymous> (${ file }:28:13)`,
    `    at Module._compile (module.js:573:32)`,
    `    at at runTest (${ jest }:50:10)`,
    `    at process._tickCallback (internal/process/next_tick.js:103:7)`
  ]
  error.stack = errorStack.join('\n')

  var out = reportersOut('runtimeError', app, undefined, error)
  expect(out).toMatchSnapshot()
})

it('reports client error', () => {
  var out = reportersOut('clientError', app, authed, clientError)
  expect(out).toMatchSnapshot()
})

it('reports synchroniation error', () => {
  var out = reportersOut('syncError', app, authed, ownError)
  expect(out).toMatchSnapshot()
})

it('reports error from unautheficated user', () => {
  var out = reportersOut('syncError', app, unauthed, clientError)
  expect(out).toMatchSnapshot()
})

it('reports destroy', () => {
  expect(reportersOut('destroy', app)).toMatchSnapshot()
})
