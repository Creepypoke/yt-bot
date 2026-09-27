import { findDownloadedVideo, runDownloader } from './cli.ts'
import type { Downloader, DownloadRequest } from './downloader.ts'

export class InstagramDownloader implements Downloader {
  constructor(
    private readonly cookiesPath?: string,
    private readonly proxy?: string,
  ) {}

  async download(request: DownloadRequest): Promise<string> {
    const command = [
      'gallery-dl',
      '--destination',
      request.outputDirectory,
      '--no-mtime',
    ]

    if (this.proxy) {
      command.push('--proxy', this.proxy)
    }

    if (this.cookiesPath) {
      command.push('--cookies', this.cookiesPath)
    }

    command.push('--', request.url)
    await runDownloader(command, request.requestId, request.signal)

    return findDownloadedVideo(request.outputDirectory, request.requestId)
  }
}
