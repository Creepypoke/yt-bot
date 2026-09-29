import { Composer } from 'gramio'

import { config } from '../config.ts'
import { logger } from '../logger.ts'
import { composer } from '../plugins/index.ts'

export const startComposer = new Composer()
  .extend(composer)
  .command('start', (context) => {
    logger.info('command.start.received', {
      userId: context.from?.id,
      chatId: context.chatId,
    })

    const isAdmin = Boolean(
      context.from?.id && config.BOT_ADMIN_IDS.includes(context.from.id),
    )

    return context.send(
      isAdmin
        ? 'Пришлите ссылку на YouTube-видео, YouTube Shorts или Instagram Reels. Для обычного YouTube-видео можно выбрать качество или MP3.'
        : 'Пришлите ссылку на YouTube Shorts или Instagram Reels — я скачаю и отправлю видео.',
    )
  })
