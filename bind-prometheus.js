let prometheus = require('prom-client')

const TIMES = [
  100, 500, 1000, 2500, 5000, 7500, 10000, 25000, 50000, 75000, 100000
]

let requestsCount = new prometheus.Counter({
  name: 'logux_request_counter',
  help: 'How many action was processed',
  labelNames: ['type']
})

let processingTime = new prometheus.Histogram({
  name: 'logux_request_processing_time_histogram',
  help: 'How long action was processed',
  buckets: TIMES
})

let subscriptionsCount = new prometheus.Counter({
  name: 'logux_subscription_counter',
  help: 'How many subscriptions was processed'
})

let subscribingTime = new prometheus.Histogram({
  name: 'logux_subscription_processing_time_histogram',
  help: 'How long channel initial data was loaded',
  buckets: TIMES
})

let clientCount = new prometheus.Gauge({
  name: 'logux_clients_gauge',
  help: 'How many clients are online'
})

let errorCount = new prometheus.Counter({
  name: 'logux_client_errors_counter',
  help: 'How many client errors was fired'
})

function bindPrometheus (app) {
  app.controls['/prometheus'] = {
    request () {
      return {
        headers: {
          'Content-Type': prometheus.register.contentType
        },
        body: prometheus.register.metrics()
      }
    }
  }

  if (app.options.controlPassword) {
    prometheus.collectDefaultMetrics()
    app.on('processed', (action, meta, latency) => {
      requestsCount.inc({ type: action.type })
      processingTime.observe(latency)
    })
    app.on('subscribed', (action, meta, latency) => {
      subscriptionsCount.inc()
      subscribingTime.observe(latency)
    })
    app.on('connected', () => {
      clientCount.set(Object.keys(app.connected).length)
    })
    app.on('disconnected', () => {
      clientCount.set(Object.keys(app.connected).length)
    })
    app.on('clientError', () => {
      errorCount.inc()
    })
  }
}

module.exports = bindPrometheus
