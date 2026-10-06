import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  findDownloadedAudio,
  findDownloadedVideo,
  runDownloader,
} from './cli.ts'
import type { Downloader, DownloadRequest } from './downloader.ts'

const DEFAULT_MAX_HEIGHT = 480
const YOUTUBE_PLAYER_CLIENT = 'youtube:player_client=tv_simply'

interface YouTubeFormat {
  ext?: unknown
  height?: unknown
  vcodec?: unknown
}

interface YouTubeMetadata {
  formats?: YouTubeFormat[]
}

export function buildYouTubeFormatSelector(height: number): string {
  return `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/b[height<=${height}][ext=mp4]/b[height<=${height}]`
}

function addYouTubeExtractorOptions(command: string[]): void {
  // The regular web client increasingly requires a proof-of-origin token for
  // media URLs, which produces HTTP 403 from server-side downloaders. The
  // TV client is supported by yt-dlp and does not require that web-only flow.
  command.push('--extractor-args', YOUTUBE_PLAYER_CLIENT)
}

export function extractAvailableResolutions(
  metadata: YouTubeMetadata,
): number[] {
  const resolutions = new Set<number>()

  for (const format of metadata.formats ?? []) {
    if (
      format.ext === 'mp4' &&
      format.vcodec !== 'none' &&
      typeof format.height === 'number' &&
      Number.isSafeInteger(format.height) &&
      format.height > 0
    ) {
      resolutions.add(format.height)
    }
  }

  return [...resolutions].sort((left, right) => left - right)
}

export class YouTubeDownloader implements Downloader {
  constructor(
    private readonly cookiesPath?: string,
    private readonly proxy?: string,
  ) {}

  private async addConnectionOptions(
    command: string[],
    outputDirectory: string,
  ): Promise<void> {
    if (this.proxy) {
      command.push('--proxy', this.proxy)
    }

    if (this.cookiesPath) {
      // yt-dlp persists refreshed cookies when it exits. Keep the configured
      // file immutable so it can safely be a read-only Docker secret.
      const cookiesPath = join(outputDirectory, 'cookies.txt')
      await writeFile(cookiesPath, await readFile(this.cookiesPath))
      command.push('--cookies', cookiesPath)
    }
  }

  async getAvailableResolutions(request: DownloadRequest): Promise<number[]> {
    const metadataPath = join(request.outputDirectory, 'metadata.info.json')
    const command = [
      'yt-dlp',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes',
      'bun',
      '--skip-download',
      '--write-info-json',
      '--output',
      join(request.outputDirectory, 'metadata'),
    ]

    addYouTubeExtractorOptions(command)
    await this.addConnectionOptions(command, request.outputDirectory)
    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    const metadata = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as YouTubeMetadata
    return extractAvailableResolutions(metadata)
  }

  async download(request: DownloadRequest): Promise<string> {
    const command = [
      'yt-dlp',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes',
      'bun',

      '--restrict-filenames',
    ]

    if (request.selection?.type === 'audio') {
      command.push(
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '5',
      )
    } else {
      command.push(
        '--format',
        buildYouTubeFormatSelector(
          request.selection?.height ?? DEFAULT_MAX_HEIGHT,
        ),
        '--merge-output-format',
        'mp4',
      )
    }

    command.push('--output', join(request.outputDirectory, 'video.%(ext)s'))
    addYouTubeExtractorOptions(command)
    await this.addConnectionOptions(command, request.outputDirectory)
    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    return request.selection?.type === 'audio'
      ? findDownloadedAudio(request.outputDirectory, request.requestId)
      : findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
