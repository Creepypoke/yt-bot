import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { MessageContext } from '@gramio/contexts'
import { Composer, InlineKeyboard, MediaUpload, type AnyBot } from 'gramio'

import { config } from '../config.ts'
import {
  DownloadError,
  type Downloader,
  type DownloadSelection,
} from '../downloaders/downloader.ts'
import { InstagramDownloader } from '../downloaders/instagram-downloader.ts'
import { YouTubeDownloader } from '../downloaders/youtube-downloader.ts'
import { logger } from '../logger.ts'
import { composer } from '../plugins/index.ts'
import {
  parseVideoUrl,
  type ParsedVideoUrl,
  type VideoSource,
} from '../url-parser.ts'
import {
  compressVideoTo480p,
  TELEGRAM_UPLOAD_LIMIT_BYTES,
  transcodeVideoForTelegram,
} from '../video-compressor.ts'

const activeUsers = new Set<number>()
const activeDownloads = new Set<AbortController>()
const youtubeDownloader = new YouTubeDownloader(
  config.YOUTUBE_COOKIES,
  config.YOUTUBE_PROXY,
  config.YOUTUBE_POT_PROVIDER_URL,
)
const downloaders: Record<VideoSource, Downloader> = {
  youtube: youtubeDownloader,
  instagram: new InstagramDownloader(
    config.INSTAGRAM_COOKIES,
    config.INSTAGRAM_PROXY,
  ),
}

const FORMAT_SELECTION_TTL_MS = 15 * 60 * 1_000
const FORMAT_CALLBACK = /^download:([a-f0-9]{8}):(audio|[1-9]\d{1,4})$/u

interface PendingFormatSelection {
  userId: number
  chatId: number
  parsedUrl: ParsedVideoUrl
  resolutions: number[]
  expiresAt: number
}

const pendingFormatSelections = new Map<string, PendingFormatSelection>()

function userFacingError(error: unknown): string {
  if (error instanceof DownloadError) {
    if (error.code === 'DOWNLOADER_NOT_FOUND') {
      return 'Загрузчик не установлен на сервере.'
    }

    if (error.code === 'VIDEO_NOT_FOUND') {
      return 'Не удалось найти видео или аудиодорожку.'
    }
  }

  if (error instanceof FileTooLargeError) {
    return `Файл слишком большой. Максимум: ${formatBytes(error.maxFileSizeBytes)}.`
  }

  return 'Не удалось скачать файл. Проверьте ссылку или попробуйте позже.'
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1_000_000
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} МБ`
}

class FileTooLargeError extends Error {
  constructor(readonly maxFileSizeBytes: number) {
    super()
  }
}

export function cancelActiveDownloads(): number {
  for (const controller of activeDownloads) controller.abort()
  return activeDownloads.size
}

function pruneFormatSelections(): void {
  const now = Date.now()
  for (const [id, selection] of pendingFormatSelections) {
    if (selection.expiresAt <= now) pendingFormatSelections.delete(id)
  }
}

async function downloadAndSend(
  context: MessageContext<AnyBot>,
  userId: number,
  parsedUrl: ParsedVideoUrl,
  selection?: DownloadSelection,
  existingStatusMessage?: MessageContext<AnyBot>,
): Promise<void> {
  activeUsers.add(userId)
  const abortController = new AbortController()
  activeDownloads.add(abortController)
  const requestId = randomUUID().slice(0, 8)
  const startedAt = performance.now()
  let temporaryDirectory: string | undefined
  let statusMessage = existingStatusMessage

  logger.info('download.request.accepted', {
    requestId,
    userId,
    chatId: context.chatId,
    source: parsedUrl.source,
    selection,
    activeRequests: activeUsers.size,
  })

  try {
    statusMessage ??= await context.send('Скачиваю...')
    await mkdir(config.DOWNLOAD_DIR, { recursive: true })
    temporaryDirectory = await mkdtemp(join(config.DOWNLOAD_DIR, 'request-'))
    logger.debug('download.temporary_directory.created', {
      requestId,
      directory: temporaryDirectory,
    })

    logger.info('download.media.starting', {
      requestId,
      source: parsedUrl.source,
      selection,
    })
    let mediaPath = await downloaders[parsedUrl.source].download({
      requestId,
      url: parsedUrl.url,
      outputDirectory: temporaryDirectory,
      signal: abortController.signal,
      selection,
    })
    const downloadedFileSize = (await stat(mediaPath)).size
    logger.info('download.media.completed', {
      requestId,
      source: parsedUrl.source,
      fileSizeBytes: downloadedFileSize,
      elapsedMs: Math.round(performance.now() - startedAt),
    })

    if (selection?.type === 'video') {
      await statusMessage.editText('Перекодирую для Telegram...')
      logger.info('download.transcoding.starting', {
        requestId,
        inputFileSizeBytes: downloadedFileSize,
        height: selection.height,
      })
      mediaPath = await transcodeVideoForTelegram(
        mediaPath,
        temporaryDirectory,
        requestId,
        abortController.signal,
        Math.min(config.MAX_FILE_SIZE, TELEGRAM_UPLOAD_LIMIT_BYTES),
      )
      logger.info('download.transcoding.completed', {
        requestId,
        outputFileSizeBytes: (await stat(mediaPath)).size,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    } else if (config.COMPRESS_TO_480P && !selection) {
      await statusMessage.editText('Сжимаю...')
      logger.info('download.compression.starting', {
        requestId,
        inputFileSizeBytes: downloadedFileSize,
      })
      mediaPath = await compressVideoTo480p(
        mediaPath,
        temporaryDirectory,
        requestId,
        abortController.signal,
      )
      logger.info('download.compression.completed', {
        requestId,
        outputFileSizeBytes: (await stat(mediaPath)).size,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    }

    const fileSize = (await stat(mediaPath)).size

    const maxUploadSize = Math.min(
      config.MAX_FILE_SIZE,
      TELEGRAM_UPLOAD_LIMIT_BYTES,
    )

    if (fileSize > maxUploadSize) {
      logger.warn('download.file_too_large', {
        requestId,
        fileSizeBytes: fileSize,
        maxFileSizeBytes: maxUploadSize,
      })
      throw new FileTooLargeError(maxUploadSize)
    }

    await statusMessage.editText('Отправляю...')
    logger.info('download.upload.starting', {
      requestId,
      fileSizeBytes: fileSize,
    })
    const upload = await MediaUpload.path(mediaPath)
    if (selection?.type === 'audio') {
      await context.sendAudio(upload)
    } else {
      await context.sendVideo(upload)
    }
    logger.info('download.request.completed', {
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    await statusMessage.delete().catch((error: unknown) =>
      logger.warn('download.status_message.delete_failed', {
        requestId,
        error,
      }),
    )
  } catch (error) {
    logger.error('download.request.failed', {
      requestId,
      userId,
      source: parsedUrl.source,
      selection,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    })

    try {
      if (statusMessage) {
        await statusMessage.editText(userFacingError(error))
      } else {
        await context.send(userFacingError(error))
      }
    } catch (statusError) {
      logger.error('download.status_message.update_failed', {
        requestId,
        error: statusError,
      })
    }
  } finally {
    activeUsers.delete(userId)
    activeDownloads.delete(abortController)

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        (error: unknown) =>
          logger.warn('download.temporary_directory.cleanup_failed', {
            requestId,
            directory: temporaryDirectory,
            error,
          }),
      )
    }

    logger.debug('download.request.finalized', {
      requestId,
      activeRequests: activeUsers.size,
      elapsedMs: Math.round(performance.now() - startedAt),
    })
  }
}

async function offerFormatSelection(
  context: MessageContext<AnyBot>,
  userId: number,
  parsedUrl: ParsedVideoUrl,
): Promise<void> {
  activeUsers.add(userId)
  const abortController = new AbortController()
  activeDownloads.add(abortController)
  const requestId = randomUUID().slice(0, 8)
  let temporaryDirectory: string | undefined
  let statusMessage: MessageContext<AnyBot> | undefined
  let selectionId: string | undefined

  try {
    statusMessage = await context.send('Получаю доступные форматы...')
    await mkdir(config.DOWNLOAD_DIR, { recursive: true })
    temporaryDirectory = await mkdtemp(join(config.DOWNLOAD_DIR, 'request-'))
    const resolutions = await youtubeDownloader.getAvailableResolutions({
      requestId,
      url: parsedUrl.url,
      outputDirectory: temporaryDirectory,
      signal: abortController.signal,
    })

    pruneFormatSelections()
    for (const [id, pendingSelection] of pendingFormatSelections) {
      if (pendingSelection.userId === userId) pendingFormatSelections.delete(id)
    }

    selectionId = randomUUID().slice(0, 8)
    pendingFormatSelections.set(selectionId, {
      userId,
      chatId: context.chatId,
      parsedUrl,
      resolutions,
      expiresAt: Date.now() + FORMAT_SELECTION_TTL_MS,
    })

    const keyboard = new InlineKeyboard().columns(3)
    for (const resolution of resolutions) {
      keyboard.text(`${resolution}p`, `download:${selectionId}:${resolution}`)
    }
    keyboard.row().text('MP3 (аудио)', `download:${selectionId}:audio`)

    await statusMessage.editText('Выберите качество или аудиодорожку:', {
      reply_markup: keyboard,
    })
  } catch (error) {
    if (selectionId) pendingFormatSelections.delete(selectionId)
    logger.error('download.formats.failed', { requestId, userId, error })
    const message = userFacingError(error)
    if (statusMessage) await statusMessage.editText(message)
    else await context.send(message)
  } finally {
    activeUsers.delete(userId)
    activeDownloads.delete(abortController)
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        (error: unknown) =>
          logger.warn('download.temporary_directory.cleanup_failed', {
            requestId,
            directory: temporaryDirectory,
            error,
          }),
      )
    }
  }
}

export const downloadComposer = new Composer()
  .extend(composer)
  .on('message', async (context) => {
    const text = context.text

    if (!text || text.startsWith('/')) return

    const userId = context.from?.id
    const isAdmin = Boolean(userId && config.BOT_ADMIN_IDS.includes(userId))
    const parsedUrl = parseVideoUrl(text, isAdmin)
    if (!parsedUrl) {
      logger.debug('download.unsupported_message', {
        userId: context.from?.id,
        chatId: context.chatId,
      })
      await context.send(
        isAdmin
          ? 'Пришлите ссылку на YouTube-видео, YouTube Shorts или Instagram Reels.'
          : 'Пришлите ссылку на YouTube Shorts или Instagram Reels.',
      )
      return
    }

    if (!userId) {
      logger.warn('download.missing_user', { chatId: context.chatId })
      return
    }

    if (activeUsers.has(userId)) {
      logger.warn('download.rejected_already_active', {
        userId,
        chatId: context.chatId,
      })
      await context.send('Дождитесь завершения предыдущей загрузки.')
      return
    }

    if (parsedUrl.isLongYouTubeVideo) {
      await offerFormatSelection(context, userId, parsedUrl)
      return
    }

    await downloadAndSend(context, userId, parsedUrl)
  })
  .callbackQuery(FORMAT_CALLBACK, async (context) => {
    const userId = context.from.id
    if (!config.BOT_ADMIN_IDS.includes(userId)) {
      await context.answerCallbackQuery({
        text: 'Недостаточно прав.',
        show_alert: true,
      })
      return
    }

    pruneFormatSelections()
    const selectionId = context.queryData[1]
    const selectedValue = context.queryData[2]
    const pendingSelection = selectionId
      ? pendingFormatSelections.get(selectionId)
      : undefined

    if (
      !selectionId ||
      !selectedValue ||
      !pendingSelection ||
      pendingSelection.userId !== userId ||
      pendingSelection.chatId !== context.chatId
    ) {
      await context.answerCallbackQuery({
        text: 'Этот выбор устарел. Отправьте ссылку еще раз.',
        show_alert: true,
      })
      return
    }

    if (!context.hasMessage()) {
      await context.answerCallbackQuery('Не удалось найти сообщение.')
      return
    }

    if (activeUsers.has(userId)) {
      await context.answerCallbackQuery({
        text: 'Дождитесь завершения предыдущей загрузки.',
        show_alert: true,
      })
      return
    }

    const selection: DownloadSelection =
      selectedValue === 'audio'
        ? { type: 'audio' }
        : { type: 'video', height: Number(selectedValue) }

    if (
      selection.type === 'video' &&
      !pendingSelection.resolutions.includes(selection.height)
    ) {
      await context.answerCallbackQuery({
        text: 'Выбранное качество недоступно.',
        show_alert: true,
      })
      return
    }

    pendingFormatSelections.delete(selectionId)
    activeUsers.add(userId)
    try {
      await context.answerCallbackQuery()
      await context.editText(
        selection.type === 'audio'
          ? 'Скачиваю аудиодорожку...'
          : `Скачиваю видео ${selection.height}p...`,
        { reply_markup: { inline_keyboard: [] } },
      )
      await downloadAndSend(
        context.message,
        userId,
        pendingSelection.parsedUrl,
        selection,
        context.message,
      )
    } catch (error) {
      logger.error('download.format_selection.failed', { userId, error })
      await context.message
        .send(userFacingError(error))
        .catch((sendError: unknown) =>
          logger.error('download.status_message.update_failed', {
            error: sendError,
          }),
        )
    } finally {
      activeUsers.delete(userId)
    }
  })
