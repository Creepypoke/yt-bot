import { findDownloadedVideo, runDownloader } from './cli.ts'
import type { Downloader, DownloadRequest } from './downloader.ts'

export class InstagramDownloader implements Downloader {
  constructor(private readonly cookiesPath?: string) {}

  async download(request: DownloadRequest): Promise<string> {
    const command = [
      'gallery-dl',
      '--destination',
      request.outputDirectory,
      '--no-mtime',
    ]

    if (this.cookiesPath) {
      command.push('--cookies', this.cookiesPath)
    }

    command.push('--', request.url)
    await runDownloader(command, request.requestId)

    return findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
