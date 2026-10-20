import { YtDlpDownloader } from './yt-dlp-downloader.ts'

export {
  buildFormatSelector as buildYouTubeFormatSelector,
  extractAvailableResolutions,
} from './yt-dlp-downloader.ts'

export class YouTubeDownloader extends YtDlpDownloader {}
