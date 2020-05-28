import { Action } from '@logux/core'

import { Server, Context, parseNodeId, ServerMeta } from '..'

function createContext (
  nodeId: string,
  subprotocol: string,
  server: object = {}
): Context {
  let { clientId, userId } = parseNodeId(nodeId)
  if (typeof userId === 'undefined') throw new Error('User ID is missed')
  return new Context(nodeId, clientId, userId, subprotocol, server as Server)
}

it('has open data', () => {
  let ctx = createContext('10:client:uuid', '2.4.0')
  expect(ctx.data).toEqual({})
})

it('saves data', () => {
  let ctx = createContext('10:client:uuid', '2.4.0')
  expect(ctx.nodeId).toEqual('10:client:uuid')
  expect(ctx.clientId).toEqual('10:client')
  expect(ctx.userId).toEqual('10')
  expect(ctx.subprotocol).toEqual('2.4.0')
})

it('detects servers', () => {
  let user = createContext('10:uuid', '2.4.0')
  expect(user.isServer).toBe(false)
  let server = createContext('server:uuid', '2.4.0')
  expect(server.isServer).toBe(true)
})

it('checks subprotocol', () => {
  let ctx = createContext('10:uuid', '2.4.0')
  expect(ctx.isSubprotocol('^2.0')).toBe(true)
  expect(ctx.isSubprotocol('>2.5')).toBe(false)
})

it('sends action back', () => {
  let entries: [Action, ServerMeta][] = []
  let promise = Promise.resolve({})
  let fakeServer = {
    process (action: Action, meta: ServerMeta) {
      entries.push([action, meta])
      return promise
    }
  }
  let ctx = createContext('10:uuid', '2.4.0', fakeServer)
  expect(ctx.sendBack({ type: 'A' })).toBe(promise)
  ctx.sendBack({ type: 'B' }, { reasons: ['1'], clients: [] })
  expect(entries).toEqual([
    [{ type: 'A' }, { clients: ['10:uuid'] }],
    [{ type: 'B' }, { reasons: ['1'], clients: [] }]
  ])
})
