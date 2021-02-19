import { yellow, cyan, bold } from 'colorette'
import dotenv from 'dotenv'

export function loadOptions (spec, process, env, defaults) {
  let rawCliArgs = gatherCliArgs(process.argv)
  if (rawCliArgs['--help']) {
    console.log(composeHelp(spec))
    process.exit(0)
  }

  let namesMap = {}
  for (let key in spec.options) {
    let option = spec.options[key]
    if (option.cli) {
      namesMap[composeCliFullName(key)] = key
      namesMap[composeEnvName(spec.envPrefix, key)] = key
      if (option.cli.alias) {
        namesMap[composeCliAliasName(option.cli.alias)] = key
      }
    }
  }

  let cliArgs = parseValues(spec, mapArgs(rawCliArgs, namesMap))
  let envArgs = {}
  if (env) {
    envArgs = parseValues(spec, mapArgs(parseEnvArgs(env), namesMap))
  }
  let opts = {}
  for (let key in spec.options) {
    opts[key] = cliArgs[key] || envArgs[key] || defaults[key]
  }
  return opts
}

export function validateOptions (spec, options) {
  let errors = []
  for (let key in options) {
    if (options[key] === undefined) {
      continue
    }
    if (!spec.options[key]) {
      errors.push({
        type: 'unknownArgument',
        arg: key
      })
    }
    let error = null
    if (spec.options[key].validate) {
      error = spec.options[key].validate(options[key])
    } else {
      error = isString(options[key])
    }
    if (error) {
      errors.push({
        type: 'failedValidation',
        arg: key,
        value: options[key],
        message: error
      })
    }
  }
  return errors
}

function gatherCliArgs (argv) {
  let args = {}
  let key = null
  let value = []
  for (let it of argv) {
    if (it.startsWith('-')) {
      if (key) {
        args[key] = value
        value = []
      }
      key = it
    } else if (key) {
      value = [...value, it]
    }
  }
  if (value.length > 1) {
    args[key] = value
  } else if (value.length === 0) {
    args[key] = true
  } else {
    args[key] = value[0]
  }
  return args
}

function parseValues (spec, args) {
  let parsed = { ...args }
  for (let key in args) {
    if (spec.options[key].cli.parse) {
      parsed[key] = spec.options[key].cli.parse(args[key])
    }
  }
  return parsed
}

function parseEnvArgs (file) {
  return dotenv.config(file).parsed
}

function mapArgs (parsedCliArgs, argsSpec) {
  return Object.fromEntries(
    Object.entries(parsedCliArgs).map(([name, value]) => {
      if (!argsSpec[name]) {
        let error = new Error('Unknown argument')
        error.arg = name
        throw error
      }
      return [argsSpec[name], value]
    })
  )
}

function composeHelp (spec) {
  let options = Object.entries(spec.options)
    .filter(([, description]) => description.cli)
    .map(([name, { cli }]) => ({
      alias: cli.alias ? composeCliAliasName(cli.alias) : '',
      full: composeCliFullName(name),
      env: (spec.envPrefix && composeEnvName(spec.envPrefix, name)) || '',
      description: cli.description
    }))
  let aliasColumnLength = Math.max(...options.map(it => it.alias.length))
  let nameColumnLength = Math.max(...options.map(it => it.full.length))
  let envColumnLength = Math.max(...options.map(it => it.env.length))

  let composeAlias = alias =>
    yellow(alias.padEnd(aliasColumnLength && aliasColumnLength + 3))
  let composeName = name => yellow(name.padEnd(nameColumnLength + 5))
  let composeEnv = env => cyan(env.padEnd(envColumnLength + 5))
  let composeOptionHelp = option => {
    return `${composeAlias(option.alias)}${composeName(
      option.full
    )}${composeEnv(option.env)}${option.description}`
  }

  return [
    bold('Options:'),
    ...options.map(option => composeOptionHelp(option)),
    bold('Examples:'),
    ...spec.examples
  ].join('\n')
}

function composeEnvName (prefix, name) {
  return `${prefix}_${name.replace(
    /[A-Z]/g,
    match => '_' + match
  )}`.toUpperCase()
}

function composeCliFullName (name) {
  return `--${toKebabCase(name)}`
}

function composeCliAliasName (name) {
  return `-${name}`
}

function toKebabCase (word) {
  let words = word.split(/[A-Z]/)
  return words.map(it => it.toLowerCase()).join('-')
}

export function isNumber (value) {
  return typeof value !== 'number' ? `Expected number, got ${value}` : null
}

export function isString (value) {
  return typeof value !== 'string' ? `Expected string, got ${value}` : null
}

export function oneOf (options, value) {
  if (!options.includes(value)) {
    return `Expected one of ${JSON.stringify(options)}, got ${value}`
  } else {
    return null
  }
}
