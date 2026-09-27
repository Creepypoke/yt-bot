export interface DownloadRequest {
  requestId: string
  url: string
  outputDirectory: string
}

export interface Downloader {
  download(request: DownloadRequest): Promise<string>
}

export type DownloadErrorCode =
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOADER_NOT_FOUND'
  | 'VIDEO_NOT_FOUND'

export class DownloadError extends Error {
  constructor(
    public readonly code: DownloadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DownloadError'
  }
}
