'use strict'

const ServerConnection = require('logux-core').ServerConnection
const MemoryStore = require('logux-core').MemoryStore
const NanoEvents = require('nanoevents')
const UrlPattern = require('url-pattern')
const WebSocket = require('ws')
const nanoid = require('nanoid')
const https = require('https')
const http = require('http')
const path = require('path')
const Log = require('logux-core').Log
const fs = require('fs')

const forcePromise = require('./force-promise')
const ServerClient = require('./server-client')
const promisify = require('./promisify')
const Creator = require('./creator')
const pkg = require('./package.json')

const PEM_PREAMBLE = '-----BEGIN'

function isPem (content) {
  if (typeof content === 'object' && content.pem) {
    return true
  } else {
    return content.toString().trim().indexOf(PEM_PREAMBLE) === 0
  }
}

function readFile (root, file) {
  file = file.toString()
  if (!path.isAbsolute(file)) {
    file = path.join(root, file)
  }
  return promisify(done => {
    fs.readFile(file, done)
  })
}

function optionError (msg) {
  const error = new Error(msg)
  error.code = 'LOGUX_WRONG_OPTIONS'
  throw error
}

/**
 * Basic Logux Server API without good UI. Use it only if you need
 * to create some special hacks on top of Logux Server.
 *
 * In most use cases you should use {@link Server}.
 *
 * @param {object} options Server options.
 * @param {string} options.subprotocol Server current application
 *                                     subprotocol version in SemVer format.
 * @param {string} options.supports npm’s version requirements for client
 *                                  subprotocol version.
 * @param {string} [options.root=process.cwd()] Application root to load files
 *                                              and show errors.
 * @param {number} [options.timeout=20000] Timeout in milliseconds
 *                                         to disconnect connection.
 * @param {number} [options.ping=10000] Milliseconds since last message to test
 *                                      connection by sending ping.
 * @param {Store} [options.store] Store to save log. Will be `MemoryStore`,
 *                                by default.
 * @param {TestTime} [options.time] Test time to test server.
 * @param {string} [options.id] Custom random ID to be used in node ID.
 * @param {"production"|"development"} [options.env] Development or production
 *                                                   server mode. By default,
 *                                                   it will be taken from
 *                                                   `NODE_ENV` environment
 *                                                   variable. On empty
 *                                                   `NODE_ENV` it will
 *                                                   be `"development"`.
 * @param {number} [options.pid] Process ID, to display in reporter.
 * @param {http.Server} [options.server] HTTP server to connect WebSocket
 *                                       server to it.
 *                                       Same as in ws.WebSocketServer.
 * @param {number} [options.port=1337] Port to bind server. It will create
 *                                     HTTP server manually to connect
 *                                     WebSocket server to it.
 * @param {string} [options.host="127.0.0.1"] IP-address to bind server.
 * @param {string} [options.key] SSL key or path to it. Path could be relative
 *                               from server root. It is required in production
 *                               mode, because WSS is highly recommended.
 * @param {string} [options.cert] SSL certificate or path to it. Path could
 *                                be relative from server root. It is required
 *                                in production mode, because WSS
 *                                is highly recommended.
 * @param {function} [options.reporter] Function to show current server status.
 *
 * @example
 * const BaseServer = require('logux-server/base-server')
 * class MyLoguxHack extends BaseServer {
 *   …
 * }
 */
class BaseServer {
  constructor (options) {
    /**
     * Server options.
     * @type {object}
     *
     * @example
     * console.log('Server options', app.options.subprotocol)
     */
    this.options = options || { }

    this.reporter = this.options.reporter || function () { }

    /**
     * Production or development mode.
     * @type {"production"|"development"}
     *
     * @example
     * if (app.env === 'development') {
     *   logDebugData()
     * }
     */
    this.env = this.options.env || process.env.NODE_ENV || 'development'

    if (typeof this.options.subprotocol === 'undefined') {
      throw optionError('Missed `subprotocol` option in server constructor')
    }
    if (typeof this.options.supports === 'undefined') {
      throw optionError('Missed `supports` option in server constructor')
    }

    if (this.options.key && !this.options.cert) {
      throw optionError('You must set `cert` option if you use `key` option')
    }
    if (!this.options.key && this.options.cert) {
      throw optionError('You must set `key` option if you use `cert` option')
    }

    if (!this.options.server) {
      if (!this.options.port) this.options.port = 1337
      if (!this.options.host) this.options.host = '127.0.0.1'
    }

    /**
     * Server unique ID.
     * @type {string}
     *
     * @example
     * console.log('Error was raised on ' + app.nodeId)
     */
    this.nodeId = `server:${ this.options.id || nanoid(8) }`

    this.options.root = this.options.root || process.cwd()

    const store = this.options.store || new MemoryStore()

    let log
    if (this.options.time) {
      log = this.options.time.nextLog({ store, nodeId: this.nodeId })
    } else {
      log = new Log({ store, nodeId: this.nodeId })
    }
    /**
     * Server actions log.
     * @type {Log}
     *
     * @example
     * app.log.each(finder)
     */
    this.log = log

    this.log.on('preadd', (action, meta) => {
      const isLogux = action.type.slice(0, 6) === 'logux/'
      if (!meta.server) {
        meta.server = this.nodeId
      }
      if (!meta.status && !isLogux) {
        meta.status = 'waiting'
      }
      if (meta.id[1] === this.nodeId) {
        if (!meta.subprotocol) {
          meta.subprotocol = this.options.subprotocol
        }
        if (!this.types[action.type] && !isLogux) {
          meta.status = 'processed'
        }
      }
    })

    this.log.on('add', (action, meta) => {
      this.reporter('add', { action, meta })

      if (this.destroying) return

      if (action.type === 'logux/subscribe') {
        if (meta.server === this.nodeId) {
          this.subscribeAction(action, meta)
        }
        return
      }

      if (action.type === 'logux/unsubscribe') {
        if (meta.server === this.nodeId) {
          this.unsubscribeAction(action, meta)
        }
        return
      }

      this.sendAction(action, meta)
      if (meta.status === 'waiting') {
        const type = this.types[action.type]
        if (!type) {
          this.unknownType(action, meta)
          return
        }
        if (type.process) this.processAction(type, action, meta)
      }
    })
    this.log.on('clean', (action, meta) => {
      this.reporter('clean', { actionId: meta.id })
    })

    this.emitter = new NanoEvents()
    this.on('error', (err, action, meta) => {
      if (meta) {
        this.reporter('error', { err, actionId: meta.id })
      } else {
        this.reporter('error', { err, fatal: true })
      }
      if (this.env === 'development') this.debugError(err)
    })

    this.unbind = []

    /**
     * Connected clients.
     * @type {ServerClient[]}
     *
     * @example
     * for (let i in app.clients) {
     *   console.log(app.clients[i].remoteAddress)
     * }
     */
    this.clients = { }
    this.nodeIds = { }
    this.users = { }
    this.types = { }
    this.processing = 0

    this.lastClient = 0

    this.channels = []
    this.subscribers = { }

    this.authAttempts = { }

    this.timeouts = { }
    this.lastTimeout = 0

    this.unbind.push(() => {
      for (const i in this.clients) this.clients[i].destroy()
      for (const i in this.timeouts) {
        clearTimeout(this.timeouts[i])
      }
    })
    this.unbind.push(() => new Promise(resolve => {
      if (this.processing === 0) {
        resolve()
      } else {
        this.on('processed', () => {
          if (this.processing === 0) resolve()
        })
      }
    }))
  }

  /**
   * Set authenticate function. It will receive client credentials
   * and node ID. It should return a Promise with `true` or `false`.
   *
   * @param {authenticator} authenticator The authentication callback.
   *
   * @return {undefined}
   *
   * @example
   * app.auth((userId, token) => {
   *   return findUserByToken(token).then(user => {
   *     return !!user && userId === user.id
   *   })
   * })
   */
  auth (authenticator) {
    this.authenticator = function () {
      return forcePromise(() => authenticator.apply(this, arguments))
    }
  }

  /**
   * Start WebSocket server and listen for clients.
   *
   * @return {Promise} When the server has been bound.
   */
  listen () {
    if (!this.authenticator) {
      throw new Error('You must set authentication callback by app.auth()')
    }

    let promise = Promise.resolve()

    if (this.options.server) {
      this.ws = new WebSocket.Server({ server: this.options.server })
    } else {
      const before = []
      if (this.options.key && !isPem(this.options.key)) {
        before.push(readFile(this.options.root, this.options.key))
      } else {
        before.push(Promise.resolve(this.options.key))
      }
      if (this.options.cert && !isPem(this.options.cert)) {
        before.push(readFile(this.options.root, this.options.cert))
      } else {
        before.push(Promise.resolve(this.options.cert))
      }

      promise = promise
        .then(() => Promise.all(before))
        .then(keys => new Promise((resolve, reject) => {
          if (keys[0] && keys[0].pem) {
            this.http = https.createServer({ key: keys[0].pem, cert: keys[1] })
          } else if (keys[0]) {
            this.http = https.createServer({ key: keys[0], cert: keys[1] })
          } else {
            this.http = http.createServer()
          }

          this.ws = new WebSocket.Server({ server: this.http })

          this.ws.on('error', reject)

          this.http.listen(this.options.port, this.options.host, resolve)
        }))
    }

    this.unbind.push(() => promisify(done => {
      promise.then(() => {
        this.ws.close()
        if (this.http) {
          this.http.close(done)
        } else {
          done()
        }
      })
    }))

    return promise.then(() => {
      this.ws.on('connection', ws => {
        this.addClient(new ServerConnection(ws))
      })
    }).then(() => {
      this.reporter('listen', {
        loguxServer: pkg.version,
        nodeId: this.nodeId,
        environment: this.env,
        subprotocol: this.options.subprotocol,
        supports: this.options.supports,
        server: !!this.options.server,
        cert: !!this.options.cert,
        host: this.options.host,
        port: this.options.port
      })
    })
  }

  /**
   * Subscribe for synchronization events. It implements nanoevents API.
   * Supported events:
   *
   * * `error`: server error.
   * * `processed`: action processing was finished.
   *
   * @param {"error"|"processed"} event The event name.
   * @param {listener} listener The listener function.
   *
   * @return {function} Unbind listener from event.
   *
   * @example
   * sync.on('error', error => {
   *   trackError(error)
   * })
   */
  on (event, listener) {
    return this.emitter.on(event, listener)
  }

  /**
   * Stop server and unbind all listeners.
   *
   * @return {Promise} Promise when all listeners will be removed.
   *
   * @example
   * afterEach(() => {
   *   testApp.destroy()
   * })
   */
  destroy () {
    this.destroying = true
    this.reporter('destroy')
    return Promise.all(this.unbind.map(i => i()))
  }

  /**
   * Define action type’s callbacks.
   *
   * @param {string} name The action’s type.
   * @param {object} callbacks Callbacks for actions with this type.
   * @param {authorizer} callback.access Check does user can do this action.
   * @param {processor} [callback.process] Action business logic.
   *
   * @return {undefined}
   *
   * @example
   * app.type('CHANGE_NAME', {
   *   access (action, meta, creator) {
   *     return action.user === creator.userId
   *   },
   *   process (action, meta) {
   *     if (isFirstOlder(lastNameChange(action.user), meta)) {
   *       return db.changeUserName({ id: action.user, name: action.name })
   *     }
   *   }
   * })
   */
  type (name, callbacks) {
    if (this.types[name]) {
      throw new Error(`Action type ${ name } was already defined`)
    }
    if (!callbacks || !callbacks.access) {
      throw new Error(`Action type ${ name } must have access callback`)
    }
    this.types[name] = callbacks
  }

  /**
   * Define the channel.
   *
   * @param {string|regexp} pattern Pattern or regular expression
   *                                for channel name.
   * @param {subscriber} callback Callback to check access, define custom action
   *                              filter and send initial actions.
   *
   * @return {undefined}
   *
   * @example
   * app.channel('user/:id', (params, action, meta, creator) => {
   *   if (params.id !== creator.userId) {
   *     return false
   *   } else {
   *     db.loadUser(params.id).then(user => {
   *       app.log.add(
   *         { type: 'USER_NAME', name: user.name },
   *         { nodeIds: [creator.nodeId] })
   *     })
   *     return (action, meta, creator) => {
   *       return !action.hidden
   *     }
   *   }
   * })
   */
  channel (pattern, callback) {
    if (typeof pattern === 'string') {
      this.channels.push({ pattern: new UrlPattern(pattern), callback })
    } else {
      this.channels.push({ regexp: pattern, callback })
    }
  }

  /**
   * Undo action from client.
   *
   * @param {Meta} meta The action’s metadata.
   * @param {string} [reason] Optional code for reason.
   *
   * @return {undefined}
   *
   * @example
   * if (couldNotFixConflict(action, meta)) {
   *   app.undo(meta)
   * }
   */
  undo (meta, reason) {
    const undoMeta = { status: 'processed' }

    if (meta.users) undoMeta.users = meta.users.slice(0)
    if (meta.reasons) undoMeta.reasons = meta.reasons.slice(0)
    if (meta.channels) undoMeta.channels = meta.channels.slice(0)

    undoMeta.nodeIds = [meta.id[1]]
    if (meta.nodeIds) undoMeta.nodeIds = undoMeta.nodeIds.concat(meta.nodeIds)

    this.log.add({ type: 'logux/undo', id: meta.id, reason }, undoMeta)
  }

  /**
   * Send runtime error stacktrace to all clients.
   *
   * @param {Error} error Runtime error instance.
   *
   * @return {undefined}
   *
   * @example
   * process.on('uncaughtException', app.debugError)
   */
  debugError (error) {
    for (const i in this.clients) {
      this.clients[i].connection.send(['debug', 'error', error.stack])
    }
  }

  /**
   * Send action, received by other server, to all clients of current server.
   * This method is for multi-server configuration only.
   *
   * @param {Action} action New action.
   * @param {Meta} meta Action’s metadata.
   *
   * @return {undefined}
   *
   * @example
   * app.log.on('add', (action, meta) => {
   *   if (meta.server === app.nodeId) {
   *     sendToOtherServersByRedis(action, meta)
   *   }
   * })
   * onReceivingFromOtherServer((action, meta) => {
   *   app.sendAction(action, meta)
   * })
   */
  sendAction (action, meta) {
    if (meta.nodeIds) {
      for (const id of meta.nodeIds) {
        if (this.nodeIds[id]) {
          this.nodeIds[id].sync.onAdd(action, meta)
        }
      }
    }

    if (meta.users) {
      for (const userId of meta.users) {
        if (this.users[userId]) {
          for (const client of this.users[userId]) {
            client.sync.onAdd(action, meta)
          }
        }
      }
    }

    if (meta.channels) {
      const creator = this.createCreator(meta)
      for (const channel of meta.channels) {
        if (this.subscribers[channel]) {
          for (const nodeId in this.subscribers[channel]) {
            let filter = this.subscribers[channel][nodeId]
            if (typeof filter === 'function') {
              filter = filter(action, meta, creator)
            }
            if (filter && this.nodeIds[nodeId]) {
              this.nodeIds[nodeId].sync.onAdd(action, meta)
            }
          }
        }
      }
    }
  }

  /**
   * Add new client for server. You should call this method manually
   * mostly for test purposes.
   *
   * @param {Connection} connection Logux connection to client.
   *
   * @return {number} Client ID,
   *
   * @example
   * server.addClient(test.right)
   */
  addClient (connection) {
    this.lastClient += 1
    const node = new ServerClient(this, connection, this.lastClient)
    this.clients[this.lastClient] = node
    return this.lastClient
  }

  processAction (type, action, meta) {
    const start = Date.now()
    const creator = this.createCreator(meta)

    this.processing += 1
    forcePromise(() => type.process(action, meta, creator)).then(() => {
      this.reporter('processed', {
        actionId: meta.id,
        latency: Date.now() - start
      })
      this.processing -= 1
      this.emitter.emit('processed', action, meta)
    }).catch(e => {
      this.log.changeMeta(meta.id, { status: 'error' })
      this.undo(meta, 'error')
      this.emitter.emit('error', e, action, meta)
      this.processing -= 1
      this.emitter.emit('processed', action, meta)
    })
  }

  unknownType (action, meta) {
    this.log.changeMeta(meta.id, { status: 'error' })
    this.reporter('unknownType', { type: action.type, actionId: meta.id })
    if (this.getUserId(meta.id[1]) !== 'server') {
      this.undo(meta, 'error')
    }
    this.debugActionError(meta, `Action with unknown type ${ action.type }`)
  }

  getUserId (nodeId) {
    const pos = nodeId.lastIndexOf(':')
    if (pos !== -1) {
      return nodeId.slice(0, pos)
    } else {
      return undefined
    }
  }

  createCreator (meta) {
    const nodeId = meta.id[1]
    const userId = this.getUserId(nodeId)

    let subprotocol
    if (meta.subprotocol) {
      subprotocol = meta.subprotocol
    } else if (this.nodeIds[nodeId]) {
      subprotocol = this.nodeIds[nodeId].sync.remoteSubprotocol
    }

    return new Creator(nodeId, userId, subprotocol)
  }

  subscribeAction (action, meta) {
    if (typeof action.channel !== 'string') {
      this.wrongChannel(action, meta)
      return
    }

    let match
    for (const i of this.channels) {
      if (i.pattern) {
        match = i.pattern.match(action.channel)
      } else {
        match = action.channel.match(i.regexp)
      }

      if (match) {
        const creator = this.createCreator(meta)
        forcePromise(() => {
          return i.callback(match, action, meta, creator)
        }).then(filter => {
          if (!filter) {
            this.denyAction(meta)
            return
          }

          const client = this.nodeIds[creator.nodeId]
          if (!client) return

          this.reporter('subscribed', {
            actionId: meta.id,
            channel: action.channel
          })

          if (!this.subscribers[action.channel]) {
            this.subscribers[action.channel] = { }
          }
          this.subscribers[action.channel][creator.nodeId] = filter
        }).catch(e => {
          this.emitter.emit('error', e, action, meta)
          this.undo(meta, 'error')
        })
        break
      }
    }

    if (!match) this.wrongChannel(action, meta)
  }

  unsubscribeAction (action, meta) {
    if (typeof action.channel !== 'string') {
      this.wrongChannel(action, meta)
      return
    }

    const nodeId = meta.id[1]
    if (this.subscribers[action.channel]) {
      delete this.subscribers[action.channel][nodeId]
      if (Object.keys(this.subscribers[action.channel]).length === 0) {
        delete this.subscribers[action.channel]
      }
    }

    this.reporter('unsubscribed', {
      actionId: meta.id,
      channel: action.channel
    })
  }

  wrongChannel (action, meta) {
    this.reporter('wrongChannel', {
      actionId: meta.id,
      channel: action.channel
    })
    this.undo(meta, 'error')
    this.debugActionError(meta, `Wrong channel name ${ action.channel }`)
  }

  denyAction (meta) {
    this.reporter('denied', { actionId: meta.id })
    this.undo(meta, 'denied')
    const id = JSON.stringify(meta.id)
    this.debugActionError(meta, `Action ${ id } was denied`)
  }

  debugActionError (meta, msg) {
    if (this.env === 'development') {
      const nodeId = meta.id[1]
      if (this.nodeIds[nodeId]) {
        this.nodeIds[nodeId].connection.send(['debug', 'error', msg])
      }
    }
  }

  setTimeout (callback, ms) {
    this.lastTimeout += 1
    const id = this.lastTimeout
    this.timeouts[id] = setTimeout(() => {
      delete this.timeouts[id]
      callback()
    }, ms)
  }
}

module.exports = BaseServer

/**
 * @callback authenticator
 * @param {string} userId User ID.
 * @param {any} credentials The client credentials.
 * @param {Client} client Client object.
 * @return {boolean|Promise} `true` or Promise with `true`
 *                           if credentials was correct
 */

/**
 * @callback authorizer
 * @param {Action} action The action data.
 * @param {Meta} meta The action metadata.
 * @param {Creator} creator Information about node, who create this action.
 * @return {boolean|Promise} `true` or Promise with `true` if client are allowed
 *                           to use this action.
 */

/**
 * @callback processor
 * @param {Action} action The action data.
 * @param {Meta} meta The action metadata.
 * @param {Creator} creator Information about node, who create this action.
 * @return {Promise|undefined} Promise when processing will be finished.
 */

/**
 * @callback filter
 * @param {Action} action The action data.
 * @param {Meta} meta The action metadata.
 * @param {Creator} creator Information about node, who create this action.
 * @return {boolean} Should action be sent to client.
 */

/**
 * @callback subscriber
 * @param {object} params Match object from channel name pattern
 *                        or from regular expression.
 * @param {Action} action The action data.
 * @param {Meta} meta The action metadata.
 * @param {Creator} creator Information about node, who create this action.
 * @return {boolean|filter|Promise} Promise with boolean or action filter.
 *                                  On `false` subscription will be denied.
 */
