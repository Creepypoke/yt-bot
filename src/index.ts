import { bot } from './bot.ts'
import { config } from './config.ts'
import { logger } from './logger.ts'

Bun.serve({
  port: config.HEALTHCHECK_PORT,
  fetch(request) {
    if (new URL(request.url).pathname === '/healthz') {
      return new Response('ok')
    }

    return new Response('Not found', { status: 404 })
  },
})

const signals = ['SIGINT', 'SIGTERM']

for (const signal of signals) {
  process.on(signal, async () => {
    logger.info('bot.shutdown.started', { signal })
    await bot.stop()
    logger.info('bot.shutdown.completed', { signal })
    process.exit(0)
  })
}

process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { error })
})

process.on('unhandledRejection', (error) => {
  logger.error('process.unhandled_rejection', { error })
})

logger.info('bot.starting', {
  environment: config.NODE_ENV,
  logLevel: config.LOG_LEVEL,
  downloadDirectory: config.DOWNLOAD_DIR,
  maxFileSizeBytes: config.MAX_FILE_SIZE,
  healthcheckPort: config.HEALTHCHECK_PORT,
  telegramPollRetryMs: config.TELEGRAM_POLL_RETRY_MS,
  instagramCookiesConfigured: Boolean(config.INSTAGRAM_COOKIES),
})
await bot.start()
