export type VideoSource = 'youtube' | 'instagram'

export interface ParsedVideoUrl {
  source: VideoSource
  url: string
  isLongYouTubeVideo?: true
}

const URL_CANDIDATE = /https?:\/\/[^\s<>]+/giu
const TRAILING_PUNCTUATION = /[),.!?;:'"\]}]+$/u

function parseSourceFromUrl(
  url: URL,
  allowRegularYouTubeVideos: boolean,
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
    allowRegularYouTubeVideos &&
    (((host === 'youtube.com' || host === 'm.youtube.com') &&
      path[0]?.toLowerCase() === 'watch' &&
      Boolean(url.searchParams.get('v'))) ||
      (host === 'youtu.be' && Boolean(path[0])))
  ) {
    return { source: 'youtube', isLongYouTubeVideo: true }
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
  allowRegularYouTubeVideos = false,
): ParsedVideoUrl | undefined {
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '')

    try {
      const url = new URL(candidate)
      const parsedSource = parseSourceFromUrl(url, allowRegularYouTubeVideos)

      if (parsedSource) {
        return { ...parsedSource, url: url.toString() }
      }
    } catch {
      // Ignore malformed candidates and keep looking for a supported URL.
    }
  }

  return undefined
}
