import { Composer } from 'gramio'

import { logger } from '../logger.ts'
import { composer } from '../plugins/index.ts'

export const startComposer = new Composer()
  .extend(composer)
  .command('start', (context) => {
    logger.info('command.start.received', {
      userId: context.from?.id,
      chatId: context.chatId,
    })

    return context.send(
      'Пришлите ссылку на YouTube Shorts или Instagram Reels — я скачаю и отправлю видео.',
    )
  })
