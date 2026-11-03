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
    const command = [
      'yt-dlp',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes',
      'bun',
    ]

    // For long YouTube videos (including live streams), use --live-from-start to download the entire stream.
    if (request.url.includes('youtube.com') && request.url.includes('/watch?v=')) {
      command.push('--live-from-start')
    }

    if (request.selection?.type === 'audio') {
      command.push(
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '5',
        '--embed-metadata',
        // Seed from the video title, then override only with a nonblank track.
        // yt-dlp's default picks empty strings before fallback fields, so use
        // nonempty captures for both title and performer. Missing fields expand
        // to an empty string instead of the default "NA" placeholder.
        '--parse-metadata',
        '%(title|)s:(?s)^\\s*(?P<meta_title>\\S(?:.*\\S)?)\\s*$',
        '--parse-metadata',
        '%(track|)s:(?s)^\\s*(?P<meta_title>\\S(?:.*\\S)?)\\s*$',
        '--windows-filenames',
        '--output',
        join(request.outputDirectory, '%(title).180B.%(ext)s'),
      )
      // Later nonblank fields override earlier fallbacks.
      for (const field of [
        'channel',
        'uploader_id',
        'uploader',
        'creators',
        'creator',
        'artists',
        'artist',
      ]) {
        let source = field
        if (field.endsWith('s')) {
          // Keep list boundaries until blank entries are removed; joining with
          // commas first would turn an entirely blank list into a valid artist.
          source = 'audio_performers'
          command.push(
            '--parse-metadata',
            `%(${field}|)#l:(?s)(?P<audio_performers>.*)`,
            '--replace-in-metadata',
            source,
            '^\\s+|\\s+$|\\n[^\\S\\n]*(?=\\n)',
            '',
            '--replace-in-metadata',
            source,
            '\\n',
            ', ',
          )
          const singular = field.slice(0, -1)
          // yt-dlp also synthesizes the scalar from an absent scalar's list.
          // Normalize that copy too, without overriding a distinct scalar.
          command.push(
            '--parse-metadata',
            `%(${singular}|)s:(?s)(?P<audio_scalar_${singular}>.*)`,
            '--parse-metadata',
            `%(${singular}|)s\n%(${field}|)l\n%(${source}|)s:(?s)^(?P<audio_joined_${singular}>.*?)\n(?P=audio_joined_${singular})\n(?P<audio_scalar_${singular}>.*)$`,
          )
        } else if (field === 'artist' || field === 'creator') {
          source = `audio_scalar_${field}`
        }
        command.push(
          '--parse-metadata',
          `%(${source}|)s:(?s)^\\s*(?P<meta_artist>\\S(?:.*\\S)?)\\s*$`,
        )
      }
    } else {
      command.push(
        '--restrict-filenames',
        '--format',
        buildFormatSelector(request.selection?.height ?? DEFAULT_MAX_HEIGHT),
        '--merge-output-format',
        'mp4',
        '--output',
        join(request.outputDirectory, 'video.%(ext)s'),
      )
    }
    await this.addConnectionOptions(command, request.outputDirectory)
    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    return request.selection?.type === 'audio'
      ? findDownloadedAudio(request.outputDirectory, request.requestId)
      : findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
