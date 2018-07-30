let forcePromise = require('../force-promise')

it('executes Promise', () => {
  return forcePromise(() => Promise.resolve('result')).then(result => {
    expect(result).toEqual('result')
  })
})

it('sends Promises error', () => {
  let error = new Error()
  return forcePromise(() => Promise.resolve().then(() => {
    throw error
  })).catch(e => {
    expect(e).toBe(error)
  })
})

it('executes sync function', () => {
  return forcePromise(() => 'result').then(result => {
    expect(result).toEqual('result')
  })
})

it('sends sync error', () => {
  let error = new Error()
  return forcePromise(() => {
    throw error
  }).catch(e => {
    expect(e).toBe(error)
  })
})
