import { Composer } from 'gramio'

import { config } from '../config.ts'
import { logger } from '../logger.ts'
import { composer } from '../plugins/index.ts'
import { cancelActiveDownloads } from './download.ts'

export const restartComposer = new Composer()
  .extend(composer)
  .command('restart', async (context) => {
    const userId = context.from?.id
    if (!userId || !config.BOT_ADMIN_IDS.includes(userId)) {
      logger.warn('command.restart.denied', { userId, chatId: context.chatId })
      return
    }

    const cancelledDownloads = cancelActiveDownloads()
    logger.info('command.restart.accepted', { userId, cancelledDownloads })
    await context.send('Перезапускаю бота. Активные загрузки отменены.')
    process.exit(0)
  })
