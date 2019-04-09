/**
 * List of meta keys permitted for clients.
 * @type {string[]}
 *
 * @example
 * const { ALLOWED_META } = require('@logux/server')
 * function outMap (action, meta) {
 *   const filtered = { }
 *   for (const i in meta) {
 *     if (ALLOWED_META.includes(i)) {
 *       filtered[i] = meta[i]
 *     }
 *   }
 *   return Promise.resolve([action, filtered])
 * }
 */
const ALLOWED_META = [
  'id', 'time', 'nodes', 'clients', 'users', 'channels', 'subprotocol'
]

module.exports = ALLOWED_META
