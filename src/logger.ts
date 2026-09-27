import { config } from './config.ts'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogMetadata = Record<string, unknown>

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const urlPattern = /https?:\/\/[^\s"']+/gi

function redact(value: string): string {
  return value.replace(urlPattern, '[redacted-url]')
}

function stringify(entry: LogMetadata): string {
  const seen = new WeakSet<object>()

  return JSON.stringify(entry, (_key: string, value: unknown) => {
    if (typeof value === 'string') return redact(value)
    if (typeof value === 'bigint') return value.toString()

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      }
    }

    return value
  })
}

function write(
  level: LogLevel,
  event: string,
  metadata: LogMetadata = {},
): void {
  if (levelPriority[level] < levelPriority[config.LOG_LEVEL]) return

  const entry = stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...metadata,
  })

  if (level === 'error') {
    console.error(entry)
  } else if (level === 'warn') {
    console.warn(entry)
  } else {
    console.log(entry)
  }
}

export const logger = {
  debug: (event: string, metadata?: LogMetadata) =>
    write('debug', event, metadata),
  info: (event: string, metadata?: LogMetadata) =>
    write('info', event, metadata),
  warn: (event: string, metadata?: LogMetadata) =>
    write('warn', event, metadata),
  error: (event: string, metadata?: LogMetadata) =>
    write('error', event, metadata),
}
