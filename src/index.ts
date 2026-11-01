import { setTimeout as delay } from 'node:timers/promises'

import { bot } from './bot.ts'
import { config } from './config.ts'
import { logger } from './logger.ts'

let ready = false
let stopping = false
const shutdown = new AbortController()

Bun.serve({
  port: config.HEALTHCHECK_PORT,
  fetch(request) {
    if (new URL(request.url).pathname === '/healthz') {
      return new Response(ready ? 'ok' : 'not ready', {
        status: ready ? 200 : 503,
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

const signals = ['SIGINT', 'SIGTERM']

for (const signal of signals) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    ready = false
    shutdown.abort()
    logger.info('bot.shutdown.started', { signal })
    await bot.stop()
    logger.info('bot.shutdown.completed', { signal })
    process.exit(0)
  })
}

function fatal(event: string, error: unknown): never {
  ready = false
  stopping = true
  shutdown.abort()
  logger.error(event, { error })
  process.exit(1)
}

process.on('uncaughtException', (error) => {
  fatal('process.uncaught_exception', error)
})

process.on('unhandledRejection', (error) => {
  fatal('process.unhandled_rejection', error)
})

logger.info('bot.starting', {
  environment: config.NODE_ENV,
  logLevel: config.LOG_LEVEL,
  downloadDirectory: config.DOWNLOAD_DIR,
  maxFileSizeBytes: config.MAX_FILE_SIZE,
  healthcheckPort: config.HEALTHCHECK_PORT,
  telegramPollRetryMs: config.TELEGRAM_POLL_RETRY_MS,
  telegramMaxFileSizeBytes: config.TELEGRAM_MAX_FILE_SIZE,
  telegramUsesLocalApi: !config.TELEGRAM_API_BASE_URL.startsWith(
    'https://api.telegram.org/',
  ),
  instagramCookiesConfigured: Boolean(config.INSTAGRAM_COOKIES),
})
let attempt = 0
while (!ready && !stopping) {
  try {
    const fetchOptions = bot.options.api.fetchOptions
    try {
      // GramIO 0.9 init() performs getMe; cancel the actual fetch (including
      // response body reads), not just a Promise.race that could start late.
      bot.options.api.fetchOptions = {
        ...fetchOptions,
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]),
      }
      await bot.init()
    } finally {
      bot.options.api.fetchOptions = fetchOptions
    }
    if (stopping) break
    await bot.start()
    ready = !stopping
  } catch (error) {
    if (stopping) break
    logger.warn('bot.startup.retry', {
      attempt: ++attempt,
      retryMs: config.TELEGRAM_POLL_RETRY_MS,
      error,
    })
    try {
      await delay(config.TELEGRAM_POLL_RETRY_MS, undefined, {
        signal: shutdown.signal,
      })
    } catch {
      // Shutdown cancels the retry wait.
    }
  }
}
