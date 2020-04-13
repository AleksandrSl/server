let { delay } = require('nanodelay')

let { TestClient, TestServer } = require('..')

let server
afterEach(() => {
  if (server) server.destroy()
})

async function catchError (cb) {
  let err
  try {
    await cb()
  } catch (e) {
    err = e
  }
  return err
}

it('connects and disconnect', async () => {
  server = new TestServer()
  let client1 = new TestClient(server, '10')
  let client2 = new TestClient(server, '10')
  await Promise.all([
    client1.connect(),
    client2.connect()
  ])
  expect(Object.keys(server.clientIds)).toEqual(['10:1', '10:2'])
  await client1.disconnect()
  expect(Object.keys(server.clientIds)).toEqual(['10:2'])
})

it('sends and collect actions', async () => {
  server = new TestServer()
  server.type('FOO', {
    access: () => true,
    process (ctx) {
      ctx.sendBack({ type: 'BAR' })
    }
  })
  server.type('RESEND', {
    access: () => true,
    resend: () => ({ user: '10' })
  })
  let [client1, client2] = await Promise.all([
    server.connect('10'),
    server.connect('11')
  ])
  let received = await client1.collect(async () => {
    await client1.log.add({ type: 'FOO' })
    await client2.log.add({ type: 'RESEND' })
    await delay(10)
  })
  expect(received).toEqual([
    { type: 'BAR' },
    { type: 'logux/processed', id: '1 10:1:test 0' },
    { type: 'RESEND' }
  ])
  expect(client1.log.actions()).toEqual([
    { type: 'FOO' },
    { type: 'RESEND' },
    { type: 'BAR' },
    { type: 'logux/processed', id: '1 10:1:test 0' }
  ])
})

it('tracks action processing', async () => {
  server = new TestServer()
  server.type('FOO', {
    access: () => true
  })
  server.type('ERR', {
    access: () => true,
    process () {
      throw new Error('test')
    }
  })
  server.type('DENIED', {
    access: () => false
  })
  server.type('UNDO', {
    access: () => true,
    process (ctx, action, meta) {
      server.undo(meta)
    }
  })
  let client = await server.connect('10')

  let processed = await client.process({ type: 'FOO' })
  expect(processed).toEqual([{ type: 'logux/processed', id: '1 10:1:test 0' }])

  let serverError = await catchError(() => client.process({ type: 'ERR' }))
  expect(serverError.message).toEqual('test')
  expect(serverError.action).toEqual({
    type: 'logux/undo', id: '3 10:1:test 0', reason: 'error'
  })

  let accessError = await catchError(() => client.process({ type: 'DENIED' }))
  expect(accessError.message).toEqual('Action was denied')

  let customError = await catchError(() => client.process({ type: 'UNDO' }))
  expect(customError.message).toEqual('Server undid action')
})

it('detects action ID dublicate', async () => {
  server = new TestServer()
  server.type('FOO', {
    access: () => true
  })
  let client = await server.connect('10')

  let processed = await client.process({ type: 'FOO' }, { id: '1 10:1:test 0' })
  expect(processed).toEqual([{ type: 'logux/processed', id: '1 10:1:test 0' }])

  let err
  try {
    await client.process({ type: 'FOO' }, { id: '1 10:1:test 0' })
  } catch (e) {
    err = e
  }
  expect(err.message).toEqual('Action 1 10:1:test 0 was already in log')
})

it('tracks subscriptions', async () => {
  server = new TestServer()
  server.channel('foo', {
    access: () => true,
    load (ctx, action) {
      ctx.sendBack({ type: 'FOO', a: action.a })
    }
  })
  let client = await server.connect('10')
  let actions1 = await client.subscribe('foo')
  expect(actions1).toEqual([{ type: 'FOO', a: undefined }])

  await client.unsubscribe('foo')
  expect(server.subscribers).toEqual({ })

  let actions2 = await client.subscribe({
    type: 'logux/subscribe', channel: 'foo', a: 1
  })
  expect(actions2).toEqual([{ type: 'FOO', a: 1 }])
})
