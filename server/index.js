import { join, relative } from 'path'
import globby from 'globby'

import { createReporter } from '../create-reporter/index.js'
import { BaseServer } from '../base-server/index.js'
import {
  isNumber,
  loadOptions,
  oneOf,
  validateOptions
} from '../options-loader/options-loader.js'

let optionsSpec = {
  options: {
    host: {
      cli: {
        alias: 'h',
        description: 'Host to bind server'
      }
    },
    port: {
      cli: {
        alias: 'p',
        description: 'Port to bind server',
        parse: it => Number.parseInt(it, 10)
      },
      validate: isNumber
    },
    key: {
      cli: {
        description: 'Path to SSL key'
      }
    },
    cert: {
      cli: {
        description: 'Path to SSL certificate'
      }
    },
    supports: {
      cli: {
        description: 'Range of supported client subprotocols'
      }
    },
    subprotocol: {
      cli: {
        description: 'Server subprotocol'
      }
    },
    logger: {
      cli: {
        alias: 'l',
        description: 'Logger type'
      },
      validate: value => oneOf(['human', 'json'], value)
    },
    backend: {
      cli: {
        description: 'Backend to process actions and authentication'
      }
    },
    controlSecret: {
      cli: {
        description: 'Secret to control Logux server'
      }
    },
    controlMask: {
      cli: {
        description: 'CIDR masks for IP addresses of control servers'
      }
    },
    redis: {
      cli: {
        description: 'URL to Redis for Logux Server Pro scaling'
      }
    },
    ping: {},
    root: {},
    store: {},
    server: {},
    env: {},
    fileUrl: {}
  },
  envPrefix: 'LOGUX',
  examples: ['$0 --port 31337 --host 127.0.0.1', 'LOGUX_PORT=1337 $0']
}

export class Server extends BaseServer {
  static loadOptions (process, defaults) {
    return loadOptions(
      optionsSpec,
      process,
      defaults.root ? { path: join(defaults.root, '.env') } : undefined,
      defaults
    )
  }

  constructor (opts = {}) {
    let validationErrors = validateOptions(optionsSpec, opts)
    if (validationErrors.length) {
      console.error(
        [
          'Validation errors:',
          ...validationErrors.map(error => mapError(error))
        ].join('\n')
      )
      process.exit(1)
    }
    if (!opts.logger) {
      opts.logger = 'human'
    }

    let reporter = createReporter(opts)

    let initialized = false
    let onError = err => {
      if (initialized) {
        this.emitter.emit('fatal', err)
      } else {
        reporter('error', { err, fatal: true })
        process.exit(1)
      }
    }
    process.on('uncaughtException', onError)
    process.on('unhandledRejection', onError)

    super(opts)

    this.on('report', reporter)
    this.on('fatal', async () => {
      if (initialized) {
        if (!this.destroying) {
          await this.destroy()
          process.exit(1)
        }
      } else {
        process.exit(1)
      }
    })

    initialized = true

    let onExit = async () => {
      await this.destroy()
      process.exit(0)
    }
    process.on('SIGINT', onExit)

    this.unbind.push(() => {
      process.removeListener('SIGINT', onExit)
    })
  }

  async listen (...args) {
    try {
      return BaseServer.prototype.listen.apply(this, args)
    } catch (err) {
      this.emitter.emit('report', 'error', { err })
      return process.exit(1)
    }
  }

  async autoloadModules (files = ['modules/*/index.js', 'modules/*.js']) {
    let matches = await globby(files, {
      cwd: this.options.root,
      absolute: true,
      onlyFiles: true
    })

    await Promise.all(
      matches.map(async file => {
        let serverModule = (await import(file)).default
        if (typeof serverModule === 'function') {
          await serverModule(this)
        } else {
          let name = relative(this.options.root, file)
          let error = new Error(
            'Server module should has default export with function ' +
              'that accepts a server'
          )
          error.logux = true
          error.note = `${name} default export is ${typeof serverModule}`
          throw error
        }
      })
    )
  }
}

function mapError (validationError) {
  if (validationError.type === 'unknownArgument') {
    return `Unknown option \`${validationError.arg}\` in server constructor\n
Maybe there is a mistake in option name or this version of Logux Server doesn't support this option`
  } else if (validationError.type === 'failedValidation') {
    return `Option \`${validationError.arg}\` in server constructor failed validation\n${validationError.message}`
  }
  return `Unknown error ${JSON.stringify(validationError)}`
}
