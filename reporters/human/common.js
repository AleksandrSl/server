var os = require('os')
var path = require('path')
var chalk = require('chalk')
var yyyymmdd = require('yyyy-mm-dd')
var stripAnsi = require('strip-ansi')

var INDENT = '  '
var PADDING = '        '
var SEPARATOR = os.EOL + os.EOL
var NEXT_LINE = os.EOL === '\n' ? '\r\v' : os.EOL

function time (c) {
  return c.dim(`at ${ yyyymmdd.withTime(module.exports.now()) }`)
}

function rightPag (str, length) {
  var add = length - stripAnsi(str).length
  for (var i = 0; i < add; i++) str += ' '
  return str
}

function labeled (c, label, color, message) {
  var labelFormat = c.bold[color].bgBlack.inverse
  var messageFormat = c.bold[color]
  var pagged = rightPag(labelFormat(label), 8)

  return `${ pagged }${ messageFormat(message) } ${ time(c) }`
}

module.exports = {

  params: function params (c, fields) {
    var max = 0
    var current
    for (var i = 0; i < fields.length; i++) {
      current = fields[i][0].length + 2
      if (current > max) max = current
    }
    return fields.map(field => {
      var name = field[0]
      var value = field[1]

      var start = PADDING + rightPag(`${ name }: `, max)
      if (value instanceof Date) {
        value = yyyymmdd.withTime(value)
      }

      if (name === 'Node ID') {
        var pos = value.indexOf(':')
        var id, random
        if (pos === -1) {
          id = ''
          random = value
        } else {
          id = value.slice(0, pos)
          random = value.slice(pos)
        }
        return start + c.bold(id) + random
      } else if (Array.isArray(value)) {
        return `${ start }[${ value.map(j => c.bold(j)).join(', ') }]`
      } else if (typeof value === 'object') {
        return start + NEXT_LINE + INDENT +
          module.exports.params(c,
            Object.keys(value).map(key => [key, value[key]]
          )).split(NEXT_LINE).join(NEXT_LINE + INDENT)
      } else {
        return start + c.bold(value)
      }
    }).join(NEXT_LINE)
  },

  info: function info (c, str) {
    return labeled(c, ' INFO ', 'green', str)
  },

  warn: function warn (c, str) {
    return labeled(c, ' WARN ', 'yellow', str)
  },

  error: function error (c, str) {
    return labeled(c, ' ERROR ', 'red', str)
  },

  hint: function hint (c, strings) {
    return strings.map(i => PADDING + i).join(NEXT_LINE)
  },

  errorParams: function errorParams (c, client) {
    if (!client) {
      return ''
    } else if (client.nodeId) {
      return module.exports.params(c, [
        ['Node ID', client.nodeId || 'unknown']
      ])
    } else {
      return module.exports.params(c, [
        ['Client ID', client.key]
      ])
    }
  },

  note: function note (c, str) {
    return PADDING + c.grey(str)
  },

  prettyStackTrace: function prettyStackTrace (c, err, root) {
    if (root.slice(-1) !== path.sep) root += path.sep

    return err.stack.split('\n').slice(1).map(i => {
      i = i.replace(/^\s*/, PADDING)
      var match = i.match(/(\s+at [^(]+ \()([^)]+)\)/)
      if (!match || match[2].indexOf(root) !== 0) {
        return c.red(i)
      } else {
        match[2] = match[2].slice(root.length)
        if (match[2].indexOf('node_modules') !== -1) {
          return c.red(`${ match[1] }${ match[2] })`)
        } else {
          return c.yellow(`${ match[1] }${ match[2] })`)
        }
      }
    }).join(NEXT_LINE)
  },

  color: function color (app) {
    if (app.env !== 'development') {
      return new chalk.constructor({ enabled: false })
    } else {
      return chalk
    }
  },

  message: function message (strings) {
    return strings.filter(i => i !== '').join(NEXT_LINE) + SEPARATOR
  },

  now: function now () {
    return new Date()
  }
}
