import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { MediaUpload } from 'gramio'
import { Composer } from 'gramio'

import { config } from '../config.ts'
import { DownloadError, type Downloader } from '../downloaders/downloader.ts'
import { InstagramDownloader } from '../downloaders/instagram-downloader.ts'
import { YouTubeDownloader } from '../downloaders/youtube-downloader.ts'
import { logger } from '../logger.ts'
import { composer } from '../plugins/index.ts'
import { parseVideoUrl, type VideoSource } from '../url-parser.ts'
import { compressVideoTo480p } from '../video-compressor.ts'

const activeUsers = new Set<number>()
const activeDownloads = new Set<AbortController>()
const downloaders: Record<VideoSource, Downloader> = {
  youtube: new YouTubeDownloader(config.YOUTUBE_COOKIES),
  instagram: new InstagramDownloader(config.INSTAGRAM_COOKIES),
}

function userFacingError(error: unknown): string {
  if (error instanceof DownloadError) {
    if (error.code === 'DOWNLOADER_NOT_FOUND') {
      return 'Загрузчик не установлен на сервере.'
    }

    if (error.code === 'VIDEO_NOT_FOUND') {
      return 'Не удалось найти видео в публикации.'
    }
  }

  if (error instanceof FileTooLargeError) {
    return `Видео слишком большое. Максимум: ${formatBytes(config.MAX_FILE_SIZE)}.`
  }

  return 'Не удалось скачать видео. Проверьте ссылку или попробуйте позже.'
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1_000_000
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} МБ`
}

class FileTooLargeError extends Error {}

export function cancelActiveDownloads(): number {
  for (const controller of activeDownloads) controller.abort()
  return activeDownloads.size
}

export const downloadComposer = new Composer()
  .extend(composer)
  .on('message', async (context) => {
    const text = context.text

    if (!text || text.startsWith('/')) return

    const parsedUrl = parseVideoUrl(text)
    if (!parsedUrl) {
      logger.debug('download.unsupported_message', {
        userId: context.from?.id,
        chatId: context.chatId,
      })
      await context.send(
        'Пришлите ссылку на YouTube Shorts или Instagram Reels.',
      )
      return
    }

    const userId = context.from?.id
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

    activeUsers.add(userId)
    const abortController = new AbortController()
    activeDownloads.add(abortController)
    const requestId = randomUUID().slice(0, 8)
    const startedAt = performance.now()
    let temporaryDirectory: string | undefined
    let statusMessage: Awaited<ReturnType<typeof context.send>> | undefined

    logger.info('download.request.accepted', {
      requestId,
      userId,
      chatId: context.chatId,
      source: parsedUrl.source,
      activeRequests: activeUsers.size,
    })

    try {
      statusMessage = await context.send('Скачиваю...')
      await mkdir(config.DOWNLOAD_DIR, { recursive: true })
      temporaryDirectory = await mkdtemp(join(config.DOWNLOAD_DIR, 'request-'))
      logger.debug('download.temporary_directory.created', {
        requestId,
        directory: temporaryDirectory,
      })

      logger.info('download.media.starting', {
        requestId,
        source: parsedUrl.source,
      })
      let videoPath = await downloaders[parsedUrl.source].download({
        requestId,
        url: parsedUrl.url,
        outputDirectory: temporaryDirectory,
        signal: abortController.signal,
      })
      const downloadedFileSize = (await stat(videoPath)).size
      logger.info('download.media.completed', {
        requestId,
        source: parsedUrl.source,
        fileSizeBytes: downloadedFileSize,
        elapsedMs: Math.round(performance.now() - startedAt),
      })

      if (config.COMPRESS_TO_480P) {
        await statusMessage.editText('Сжимаю...')
        logger.info('download.compression.starting', {
          requestId,
          inputFileSizeBytes: downloadedFileSize,
        })
        videoPath = await compressVideoTo480p(
          videoPath,
          temporaryDirectory,
          requestId,
          abortController.signal,
        )
        logger.info('download.compression.completed', {
          requestId,
          outputFileSizeBytes: (await stat(videoPath)).size,
          elapsedMs: Math.round(performance.now() - startedAt),
        })
      }

      const fileSize = (await stat(videoPath)).size

      if (fileSize > config.MAX_FILE_SIZE) {
        logger.warn('download.file_too_large', {
          requestId,
          fileSizeBytes: fileSize,
          maxFileSizeBytes: config.MAX_FILE_SIZE,
        })
        throw new FileTooLargeError()
      }

      await statusMessage.editText('Отправляю...')
      logger.info('download.upload.starting', {
        requestId,
        fileSizeBytes: fileSize,
      })
      await context.sendVideo(await MediaUpload.path(videoPath))
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
  })
