import { Bot } from 'gramio'

import { config } from './config.ts'
import { downloadComposer } from './handlers/download.ts'
import { restartComposer } from './handlers/restart.ts'
import { startComposer } from './handlers/start.ts'
import { logger } from './logger.ts'
import { composer } from './plugins/index.ts'

export const bot = new Bot(config.BOT_TOKEN)
  .extend(composer)
  .extend(startComposer)
  .extend(downloadComposer)
  .extend(restartComposer)
  .onStart(({ info }) =>
    logger.info('bot.started', { username: info.username }),
  )
