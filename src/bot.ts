import { Bot } from 'gramio'

import { config } from './config.ts'
import { downloadComposer } from './handlers/download.ts'
import { restartComposer } from './handlers/restart.ts'
import { startComposer } from './handlers/start.ts'
import { logger } from './logger.ts'
import { composer } from './plugins/index.ts'

export const bot = new Bot(config.BOT_TOKEN, {
  api: {
    baseURL: config.TELEGRAM_API_BASE_URL,
    retryGetUpdatesWait: config.TELEGRAM_POLL_RETRY_MS,
  },
})
  .extend(composer)
  .extend(startComposer)
  .extend(downloadComposer)
  .extend(restartComposer)
  .onStart(({ info }) =>
    logger.info('bot.started', { username: info.username }),
  )
