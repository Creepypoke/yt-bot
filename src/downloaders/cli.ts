import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { logger } from '../logger.ts'
import { DownloadError } from './downloader.ts'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm'])
const PROCESS_HEARTBEAT_INTERVAL_MS = 15_000
const STDERR_TAIL_LENGTH = 2_000

type DownloaderStage =
  | 'extracting_url'
  | 'fetching_metadata'
  | 'fetching_media_manifest'
  | 'downloading_media'
  | 'merging_media'
  | 'cleaning_up'

function getDownloaderStage(line: string): DownloaderStage | undefined {
  if (line.includes('Extracting URL')) return 'extracting_url'
  if (
    line.includes('Downloading webpage') ||
    line.includes('Downloading initial data') ||
    line.includes('Downloading player')
  ) {
    return 'fetching_metadata'
  }
  if (line.includes('Downloading m3u8 information')) {
    return 'fetching_media_manifest'
  }
  if (line.includes('Destination:')) return 'downloading_media'
  if (line.includes('Merging formats into')) return 'merging_media'
  if (line.includes('Deleting original file')) return 'cleaning_up'
}

async function readProcessStderr(
  stream: ReadableStream<Uint8Array>,
  command: string,
  requestId: string,
  startedAt: number,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let stderrTail = ''
  let lineBuffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const output = decoder.decode(value, { stream: true })
      stderrTail = `${stderrTail}${output}`.slice(-STDERR_TAIL_LENGTH)
      lineBuffer = `${lineBuffer}${output}`.replaceAll('\r', '\n')

      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const stage = getDownloaderStage(line.trim())
        if (stage) {
          logger.info('downloader.process.stage', {
            requestId,
            command,
            stage,
            elapsedMs: Math.round(performance.now() - startedAt),
          })
        }
      }
    }

    const remainingOutput = decoder.decode()
    stderrTail = `${stderrTail}${remainingOutput}`.slice(-STDERR_TAIL_LENGTH)
    return stderrTail
  } finally {
    reader.releaseLock()
  }
}

export async function runDownloader(
  command: string[],
  requestId: string,
  signal?: AbortSignal,
): Promise<void> {
  let process: Bun.Subprocess<'ignore', 'ignore', 'pipe'>
  const commandName = command[0] ?? 'unknown'
  const startedAt = performance.now()

  logger.info('downloader.process.starting', {
    requestId,
    command: commandName,
  })

  try {
    process = Bun.spawn(command, {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    })
  } catch (error) {
    logger.error('downloader.process.start_failed', {
      command: commandName,
      requestId,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    })
    throw new DownloadError(
      'DOWNLOADER_NOT_FOUND',
      `Could not start ${command[0]}`,
      { cause: error },
    )
  }

  const abortProcess = () => process.kill()
  signal?.addEventListener('abort', abortProcess, { once: true })

  const stderrPromise = readProcessStderr(
    process.stderr,
    commandName,
    requestId,
    startedAt,
  )
  const heartbeat = setInterval(() => {
    logger.info('downloader.process.still_running', {
      requestId,
      command: commandName,
      elapsedMs: Math.round(performance.now() - startedAt),
    })
  }, PROCESS_HEARTBEAT_INTERVAL_MS)

  const exitCode = await process.exited
  signal?.removeEventListener('abort', abortProcess)
  clearInterval(heartbeat)
  const stderr = await stderrPromise

  if (exitCode !== 0) {
    logger.error('downloader.process.failed', {
      command: commandName,
      requestId,
      exitCode,
      elapsedMs: Math.round(performance.now() - startedAt),
      stderrTail: stderr.slice(-2_000),
    })
    throw new DownloadError(
      'DOWNLOAD_FAILED',
      `${command[0]} exited with code ${exitCode}: ${stderr.slice(-2_000)}`,
    )
  }

  logger.info('downloader.process.completed', {
    command: commandName,
    requestId,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
}

async function collectVideoFiles(directory: string): Promise<string[]> {
  const result: string[] = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      result.push(...(await collectVideoFiles(path)))
    } else if (
      entry.isFile() &&
      VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ) {
      result.push(path)
    }
  }

  return result
}

export async function findDownloadedVideo(
  directory: string,
  requestId: string,
): Promise<string> {
  const files = await collectVideoFiles(directory)

  logger.info('downloader.files.discovered', {
    directory,
    requestId,
    videoFileCount: files.length,
  })

  if (files.length === 0) {
    throw new DownloadError(
      'VIDEO_NOT_FOUND',
      'Downloader completed without producing a video file',
    )
  }

  const filesWithSizes = await Promise.all(
    files.map(async (path) => ({ path, size: (await stat(path)).size })),
  )
  filesWithSizes.sort((left, right) => right.size - left.size)

  const video = filesWithSizes[0]!
  logger.info('downloader.video.selected', {
    requestId,
    fileName: video.path.split(/[\\/]/).pop(),
    sizeBytes: video.size,
  })

  return video.path
}
