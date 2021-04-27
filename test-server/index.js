import { TestTime } from '@logux/core'

import { createReporter } from '../create-reporter/index.js'
import { BaseServer } from '../base-server/index.js'
import { TestClient } from '../test-client/index.js'

export class TestServer extends BaseServer {
  constructor (opts = {}) {
    if (!opts.time) {
      opts.time = new TestTime()
    }

    opts.time.lastId += 1
    super({
      subprotocol: '0.0.0',
      supports: '0.0.0',
      id: `${opts.time.lastId}`,
      ...opts
    })
    if (opts.logger) {
      this.on('report', createReporter(opts))
    }
    if (opts.auth !== false) this.auth(() => true)
    this.testUsers = {}
  }

  async connect (userId, opts = {}) {
    let client = new TestClient(this, userId, opts)
    await client.connect()
    return client
  }
}
