export type VideoSource = 'youtube' | 'instagram' | 'vk'

export interface ParsedVideoUrl {
  source: VideoSource
  url: string
  isLongYouTubeVideo?: true
}

const URL_CANDIDATE = /https?:\/\/[^\s<>]+/giu
const TRAILING_PUNCTUATION = /[),.!?;:'"\]}]+$/u

function parseSourceFromUrl(
  url: URL,
  allowRegularVideos: boolean,
): Pick<ParsedVideoUrl, 'source' | 'isLongYouTubeVideo'> | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./u, '')
  const path = url.pathname.split('/').filter(Boolean)

  if (
    (host === 'youtube.com' || host === 'm.youtube.com') &&
    path[0]?.toLowerCase() === 'shorts' &&
    Boolean(path[1])
  ) {
    return { source: 'youtube' }
  }

  if (
    allowRegularVideos &&
    (((host === 'youtube.com' || host === 'm.youtube.com') &&
      path[0]?.toLowerCase() === 'watch' &&
      Boolean(url.searchParams.get('v'))) ||
      (host === 'youtu.be' && Boolean(path[0])))
  ) {
    return { source: 'youtube', isLongYouTubeVideo: true }
  }

  if (
    allowRegularVideos &&
    [
      'vk.ru',
      'm.vk.ru',
      'vkvideo.ru',
      'm.vkvideo.ru',
      'vk.com',
      'm.vk.com',
    ].includes(host)
  ) {
    const videoPath = /^\/video-?\d+_\d+\/?$/u.test(url.pathname)
    const embeddedVideo =
      url.pathname === '/video_ext.php' &&
      /^-?\d+$/u.test(url.searchParams.get('oid') ?? '') &&
      /^\d+$/u.test(url.searchParams.get('id') ?? '')
    const linkedVideo = /^video-?\d+_\d+(?:\/|$)/u.test(
      url.searchParams.get('z') ?? '',
    )

    if (videoPath || embeddedVideo || linkedVideo) return { source: 'vk' }
  }

  if (
    (host === 'instagram.com' || host === 'www.instagram.com') &&
    ['p', 'reel', 'reels'].includes(path[0]?.toLowerCase() ?? '') &&
    Boolean(path[1])
  ) {
    return { source: 'instagram' }
  }

  return undefined
}

export function parseVideoUrl(
  text: string,
  allowRegularVideos = false,
): ParsedVideoUrl | undefined {
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '')

    try {
      const url = new URL(candidate)
      const parsedSource = parseSourceFromUrl(url, allowRegularVideos)

      if (parsedSource) {
        if (parsedSource.source === 'vk') {
          url.hostname = url.hostname.replace(/^www\./u, '')
        }
        // Feed the actual video URL to yt-dlp instead of a feed/profile page.
        if (parsedSource.source === 'vk' && url.searchParams.has('z')) {
          const videoId = /^video(-?\d+_\d+)(?:\/|$)/u.exec(
            url.searchParams.get('z') ?? '',
          )?.[1]
          if (videoId) {
            url.pathname = `/video${videoId}`
            url.searchParams.delete('z')
          }
        }
        return { ...parsedSource, url: url.toString() }
      }
    } catch {
      // Ignore malformed candidates and keep looking for a supported URL.
    }
  }

  return undefined
}
