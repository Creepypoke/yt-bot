import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findDownloadedVideo, runDownloader } from './cli.ts'
import type { Downloader, DownloadRequest } from './downloader.ts'

export class YouTubeDownloader implements Downloader {
  constructor(private readonly cookiesPath?: string) {}

  async download(request: DownloadRequest): Promise<string> {
    const command = [
      'yt-dlp',
      '--no-playlist',
      '--no-progress',
      '--js-runtimes',
      'node',

      '--restrict-filenames',
      '--format',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format',
      'mp4',
      '--output',
      join(request.outputDirectory, 'video.%(ext)s'),
    ]

    if (this.cookiesPath) {
      // yt-dlp persists refreshed cookies when it exits. Keep the configured
      // file immutable so it can safely be a read-only Docker secret.
      const cookiesPath = join(request.outputDirectory, 'cookies.txt')
      await copyFile(this.cookiesPath, cookiesPath)
      command.push('--cookies', cookiesPath)
    }

    command.push('--', request.url)
    await runDownloader(command, request.requestId)

    return findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
