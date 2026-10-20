import { YtDlpDownloader } from './yt-dlp-downloader.ts'

export class VkDownloader extends YtDlpDownloader {
  constructor(cookiesPath?: string, proxy?: string) {
    super(cookiesPath, proxy)
  }
}
