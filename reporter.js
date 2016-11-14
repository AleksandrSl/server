var yyyymmdd = require('yyyy-mm-dd')
var chalk = require('chalk')
var stripAnsi = require('strip-ansi')
var path = require('path')

var pkg = require('./package.json')

var PADDING_LEFT = 8

var LOG_LEVELS = {
  info: {
    label: ' INFO ',
    color: 'green'
  },
  warn: {
    label: ' WARN ',
    color: 'yellow'
  },
  error: {
    label: ' ERROR ',
    color: 'red'
  }
}

function rightPag (str, length) {
  var add = length - stripAnsi(str).length
  for (var i = 0; i < add; i++) str += ' '
  return str
}

var emptyPaddingLeft = rightPag('', PADDING_LEFT)

function time (c) {
  return c.dim('at ' + yyyymmdd.withTime(module.exports.now()))
}

function line (c, level, message) {
  var labelStr = c
    .bold[level.color]
    .bgBlack
    .inverse(level.label)
  var messageStr = c.bold[level.color](message)
  return '\n' +
    rightPag(labelStr, 8) +
    messageStr + ' ' +
    time(c) +
    '\n'
}

function info (c, str) {
  return line(c, LOG_LEVELS.info, str)
}

function warn (c, str) {
  return line(c, LOG_LEVELS.warn, str)
}

function error (c, str) {
  return line(c, LOG_LEVELS.error, str)
}

function params (c, type, fields) {
  var max = 0
  var current
  for (var i = 0; i < fields.length; i++) {
    current = fields[i][0].length + 2
    if (current > max) max = current
  }
  return fields.map(function (field) {
    return emptyPaddingLeft + rightPag(field[0] + ': ', max) + c.white(field[1])
  }).join('\n') + '\n'
}

function errorParams (c, type, client) {
  if (!client) {
    return ''
  } else {
    var user = client.user ? client.user.id : 'unauthenticated'
    var subprotocol = 'unknown'
    if (client.sync.otherSubprotocol) {
      subprotocol = client.sync.otherSubprotocol.join('.')
    }
    return params(c, 'error', [
      ['User ID', user],
      ['Node ID', client.nodeId || 'unknown'],
      ['Subprotocol', subprotocol],
      ['IP address', client.remoteAddress]
    ])
  }
}

function note (c, str) {
  return emptyPaddingLeft + c.grey(str) + '\n'
}

function prettyStackTrace (c, err, root) {
  if (root.slice(-1) !== path.sep) root += path.sep

  return err.stack.split('\n').slice(1).map(function (i) {
    i = i.replace(/^\s*/, emptyPaddingLeft)
    var match = i.match(/(\s+at [^(]+ \()([^)]+)\)/)
    if (!match || match[2].indexOf(root) !== 0) {
      return c.red(i)
    } else {
      match[2] = match[2].slice(root.length)
      if (match[2].indexOf('node_modules') !== -1) {
        return c.red(match[1] + match[2] + ')')
      } else {
        return c.yellow(match[1] + match[2] + ')')
      }
    }
  }).join('\n') + '\n'
}

var reporters = {

  listen: function listen (c, app) {
    var url
    if (app.listenOptions.server) {
      url = 'Custom HTTP server'
    } else {
      url = (app.listenOptions.cert ? 'wss://' : 'ws://') +
        app.listenOptions.host + ':' + app.listenOptions.port
    }

    var supports = app.options.supports.map(function (i) {
      return i + '.x'
    }).join(', ')

    var dev = app.env === 'development'

    return info(c, 'Logux server is listening') +
           params(c, 'info', [
             ['Logux server', pkg.version],
             ['PID', app.options.pid],
             ['Node ID', app.options.nodeId],
             ['Environment', app.env],
             ['Subprotocol', app.options.subprotocol.join('.')],
             ['Supports', supports],
             ['Listen', url]
           ]) +
           (dev ? note(c, 'Press Ctrl-C to shutdown server') : '')
  },

  connect: function connect (c, app, ip) {
    return info(c, 'Client was connected') +
           params(c, 'info', [['IP address', ip]])
  },

  authenticated: function authenticated (c, app, client) {
    return info(c, 'User was authenticated') +
           params(c, 'info', [
             ['User ID', client.user.id],
             ['Node ID', client.nodeId || 'unknown'],
             ['Subprotocol', client.sync.otherSubprotocol.join('.')],
             ['Logux protocol', client.sync.otherProtocol.join('.')],
             ['IP address', client.remoteAddress]
           ])
  },

  disconnect: function disconnect (c, app, client) {
    var user = client.user ? client.user.id : 'unauthenticated'
    return info(c, 'Client was disconnected') +
           params(c, 'info', [
             ['User ID', user],
             ['Node ID', client.nodeId || 'unknown'],
             ['IP address', client.remoteAddress]
           ])
  },

  destroy: function destroy (c) {
    return info(c, 'Shutting down Logux server')
  },

  runtimeError: function runtimeError (c, app, client, err) {
    var prefix = err.name + ': ' + err.message
    if (err.name === 'Error') prefix = err.message
    return error(c, prefix) +
           prettyStackTrace(c, err, app.options.root) +
           errorParams(c, 'error', client)
  },

  syncError: function syncError (c, app, client, err) {
    var prefix
    if (err.received) {
      prefix = 'SyncError from client: ' + err.description
    } else {
      prefix = 'SyncError: ' + err.description
    }
    return error(c, prefix) +
           errorParams(c, 'error', client)
  },

  clientError: function clientError (c, app, client, err) {
    return warn(c, 'Client error: ' + err.description) +
           errorParams(c, 'warn', client)
  }

}

module.exports = function (type, app) {
  var c = chalk
  if (app.env !== 'development') {
    c = new chalk.constructor({ enabled: false })
  }

  var reporter = reporters[type]
  var args = [c].concat(Array.prototype.slice.call(arguments, 1))

  return reporter.apply({ }, args)
}

module.exports.now = function () {
  return new Date()
}
