import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  findDownloadedAudio,
  findDownloadedVideo,
  runDownloader,
} from './cli.ts'
import type { Downloader, DownloadRequest } from './downloader.ts'

const DEFAULT_MAX_HEIGHT = 480

interface VideoFormat {
  ext?: unknown
  height?: unknown
  vcodec?: unknown
}

interface VideoMetadata {
  formats?: VideoFormat[]
}

export function buildFormatSelector(height: number): string {
  return `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/b[height<=${height}][ext=mp4]/b[height<=${height}]`
}

export function extractAvailableResolutions(metadata: VideoMetadata): number[] {
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

export class YtDlpDownloader implements Downloader {
  constructor(
    private readonly cookiesPath?: string,
    private readonly proxy?: string,
    private readonly potProviderUrl?: string,
  ) {}

  private async addConnectionOptions(
    command: string[],
    outputDirectory: string,
  ): Promise<void> {
    if (this.proxy) {
      command.push('--proxy', this.proxy)
    }

    if (this.potProviderUrl) {
      // The provider produces a fresh, video-bound PO token for yt-dlp. Do
      // not force a player client here: yt-dlp selects the best client for
      // the available account cookies and requested media.
      command.push(
        '--extractor-args',
        `youtubepot-bgutilhttp:base_url=${this.potProviderUrl}`,
      )
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

    await this.addConnectionOptions(command, request.outputDirectory)
    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    const metadata = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as VideoMetadata
    return extractAvailableResolutions(metadata)
  }

  async download(request: DownloadRequest): Promise<string> {
    const isAudio = request.selection?.type === 'audio'
    // When extracting audio, preserve the video title in the filename and embed
    // metadata (artist/title/genre/etc.) so Telegram shows the video's name and
    // creator instead of a generic filename. Non-ASCII titles are written
    // verbatim (not reduced to underscores), so `--windows-filenames` keeps the
    // filename within Windows-safe limits while preserving the full title. The
    // `.180B` bound prevents "File name too long" errors.
    const outputTemplate = isAudio ? '%(title).180B.%(ext)s' : 'video.%(ext)s'

    const command = [
      'yt-dlp',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes',
      'bun',

      '--windows-filenames',
    ]

    if (isAudio) {
      command.push(
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '5',
        '--embed-metadata',
        // Write the info.json so readAudioMetadata can read the title/creator
        // for the Telegram upload. Only needed for audio, never for video.
        '--write-info-json',
      )
    } else {
      const height =
        request.selection?.type === 'video'
          ? request.selection.height
          : DEFAULT_MAX_HEIGHT
      command.push(
        '--format',
        buildFormatSelector(height),
        '--merge-output-format',
        'mp4',
      )
    }

    command.push('--output', join(request.outputDirectory, outputTemplate))
    await this.addConnectionOptions(command, request.outputDirectory)
    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    return isAudio
      ? findDownloadedAudio(request.outputDirectory, request.requestId)
      : findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
