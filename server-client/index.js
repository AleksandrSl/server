let { LoguxError } = require('@logux/core')
let semver = require('semver')

let FilteredNode = require('../filtered-node')
let ALLOWED_META = require('../allowed-meta')
let parseNodeId = require('../parse-node-id')
let filterMeta = require('../filter-meta')

function reportDetails (client) {
  return {
    connectionId: client.key,
    subprotocol: client.node.remoteSubprotocol,
    nodeId: client.nodeId
  }
}

function reportClient (client, obj) {
  if (client.nodeId) {
    obj.nodeId = client.nodeId
  } else {
    obj.connectionId = client.key
  }
  return obj
}

class ServerClient {
  constructor (app, connection, key) {
    this.app = app
    this.userId = undefined
    this.clientId = undefined
    this.nodeId = undefined
    this.processing = false
    this.connection = connection
    this.key = key.toString()
    if (connection.ws) {
      this.remoteAddress = connection.ws._socket.remoteAddress
    } else {
      this.remoteAddress = '127.0.0.1'
    }

    let token
    if (this.app.env === 'development') token = 'development'

    this.node = new FilteredNode(this, app.nodeId, app.log, connection, {
      subprotocol: app.options.subprotocol,
      inFilter: this.filter.bind(this),
      timeout: app.options.timeout,
      outMap: this.outMap.bind(this),
      inMap: this.inMap.bind(this),
      token,
      ping: app.options.ping,
      auth: this.auth.bind(this)
    })

    this.node.catch(err => {
      this.app.emitter.emit('error', reportClient(this, err))
    })
    this.node.on('connect', () => {
      if (!this.isSubprotocol(this.app.options.supports)) {
        throw new LoguxError('wrong-subprotocol', {
          supported: this.app.options.supports,
          used: this.node.remoteSubprotocol
        })
      }
    })
    this.node.on('state', () => {
      if (!this.node.connected && !this.destroyed) this.destroy()
    })
    this.node.on('clientError', err => {
      if (err.type !== 'wrong-credentials') {
        this.app.emitter.emit('clientError', reportClient(this, err))
      }
    })

    this.app.emitter.emit('connected', this)
  }

  isSubprotocol (range) {
    return semver.satisfies(this.node.remoteSubprotocol, range)
  }

  destroy () {
    this.destroyed = true
    this.node.destroy()
    if (this.userId) {
      let users = this.app.userIds.get(this.userId)
      if (users) {
        users = users.filter(i => i !== this)
        if (users.length === 0) {
          this.app.userIds.delete(this.userId)
        } else {
          this.app.userIds.set(this.userId, users)
        }
      }
    }
    if (this.clientId) {
      this.app.clientIds.delete(this.clientId)
      this.app.nodeIds.delete(this.nodeId)
      for (let i in this.app.subscribers) {
        delete this.app.subscribers[i][this.nodeId]
        if (Object.keys(this.app.subscribers[i]).length === 0) {
          delete this.app.subscribers[i]
        }
      }
    }
    if (!this.app.destroying) {
      this.app.emitter.emit('disconnected', this)
    }
    this.app.connected.delete(this.key)
  }

  async auth (nodeId, token) {
    this.nodeId = nodeId
    let data = parseNodeId(nodeId)
    this.clientId = data.clientId
    this.userId = data.userId

    if (nodeId === 'server' || data.userId === 'server') {
      this.app.reporter('unauthenticated', reportDetails(this))
      return false
    }

    let start = Date.now()
    let result = await this.app.authenticator(this.userId, token, this)

    if (this.app.isBruteforce(this.remoteAddress)) {
      throw new LoguxError('bruteforce')
    }

    if (result) {
      let zombie = this.app.clientIds.get(this.clientId)
      if (zombie) {
        zombie.zombie = true
        this.app.reporter('zombie', { nodeId: zombie.nodeId })
        zombie.destroy()
      }
      this.app.clientIds.set(this.clientId, this)
      this.app.nodeIds.set(this.nodeId, this)
      if (this.userId) {
        if (!this.app.userIds.has(this.userId)) {
          this.app.userIds.set(this.userId, [this])
        } else {
          this.app.userIds.get(this.userId).push(this)
        }
      }
      this.app.emitter.emit('authenticated', this, Date.now() - start)
      this.app.reporter('authenticated', reportDetails(this))
    } else {
      this.app.reporter('unauthenticated', reportDetails(this))
      this.app.rememberBadAuth(this.remoteAddress)
    }
    return result
  }

  async outMap (action, meta) {
    return [action, filterMeta(meta)]
  }

  async inMap (action, meta) {
    if (!meta.subprotocol) {
      meta.subprotocol = this.node.remoteSubprotocol
    }
    return [action, meta]
  }

  async filter (action, meta) {
    let ctx = this.app.createContext(action, meta)

    let wrongUser = !this.clientId || this.clientId !== ctx.clientId
    let wrongMeta = Object.keys(meta).some(i => !ALLOWED_META.includes(i))
    if (wrongUser || wrongMeta) {
      this.app.contexts.delete(action)
      this.denyBack(meta)
      return false
    }

    let type = action.type
    if (type === 'logux/subscribe' || type === 'logux/unsubscribe') {
      return true
    }

    let processor = this.app.getProcessor(type)
    if (!processor) {
      this.app.internalUnkownType(action, meta)
      return false
    }

    try {
      let result = await processor.access(ctx, action, meta)
      if (this.app.unknownTypes[meta.id]) {
        delete this.app.unknownTypes[meta.id]
        this.app.finally(processor, ctx, action, meta)
        return false
      } else if (!result) {
        this.app.finally(processor, ctx, action, meta)
        this.denyBack(meta)
        return false
      } else {
        return true
      }
    } catch (e) {
      this.app.undo(meta, 'error')
      this.app.emitter.emit('error', e, action, meta)
      this.app.finally(processor, ctx, action, meta)
      return false
    }
  }

  denyBack (meta) {
    this.app.reporter('denied', { actionId: meta.id })
    let [action, undoMeta] = this.app.buildUndo(meta, 'denied', {})
    undoMeta.clients = (undoMeta.clients || []).concat([this.clientId])
    this.app.log.add(action, undoMeta)
    this.app.debugActionError(meta, `Action "${meta.id}" was denied`)
  }
}

module.exports = ServerClient
