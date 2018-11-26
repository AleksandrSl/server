let ServerNode = require('logux-core/server-node')

function has (array, item) {
  return array && array.indexOf(item) !== -1
}

class FilteredNode extends ServerNode {
  constructor (client, nodeId, log, connection, options) {
    super(nodeId, log, connection, options)
    this.client = client

    // Remove add event listener
    this.unbind[0]()
    this.unbind.splice(0, 1)
  }

  syncSinceQuery (lastSynced) {
    let data = { added: 0, entries: [] }
    return this.log.each({ order: 'added' }, (action, meta) => {
      if (meta.added <= lastSynced) {
        return false
      } else {
        if (
          has(meta.nodeIds, this.client.nodeId) ||
          has(meta.clients, this.client.clientId) ||
          has(meta.users, this.client.userId)
        ) {
          if (meta.added > data.added) data.added = meta.added
          data.entries.push([action, meta])
        }
        return true
      }
    }).then(() => data)
  }
}

module.exports = FilteredNode
