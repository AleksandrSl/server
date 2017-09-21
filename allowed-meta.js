'use strict'

/**
 * List of meta keys permitted for clients.
 * @type {string[]}
 *
 * @example
 * const ALLOWED_META = require('logux-server/allowed-meta')
 * function outMap (action, meta) {
 *   const filtered = { }
 *   for (const i in meta) {
 *     if (['id', 'time'].indexOf(i) !== -1) {
 *       filtered[i] = meta[i]
 *     }
 *   }
 *   return Promise.resolve([action, filtered])
 * }
 */
const ALLOWED_META = [
  'id', 'time', 'nodeIds', 'users', 'channels', 'subprotocol'
]

module.exports = ALLOWED_META
