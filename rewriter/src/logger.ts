type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  debug: (message: string, fields?: LogFields) => void
  info: (message: string, fields?: LogFields) => void
  warn: (message: string, fields?: LogFields) => void
  error: (message: string, fields?: LogFields) => void
  child: (bindings: LogFields) => Logger
}

function createLogger(bindings?: LogFields): Logger {
  function emit(level: LogLevel, message: string, fields?: LogFields) {
    const entry = { level, message, ...bindings, ...fields }
    const line = JSON.stringify(entry)
    if (level === 'error')
      console.error(line)
    else
      console.log(line)
  }

  return {
    debug: (message, fields?) => emit('debug', message, fields),
    info: (message, fields?) => emit('info', message, fields),
    warn: (message, fields?) => emit('warn', message, fields),
    error: (message, fields?) => emit('error', message, fields),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  }
}

export const log = createLogger()
