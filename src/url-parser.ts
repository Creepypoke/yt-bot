export type VideoSource = 'youtube' | 'instagram'

export interface ParsedVideoUrl {
  source: VideoSource
  url: string
}

const URL_CANDIDATE = /https?:\/\/[^\s<>]+/giu
const TRAILING_PUNCTUATION = /[),.!?;:'"\]}]+$/u

function sourceFromUrl(url: URL): VideoSource | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./u, '')
  const path = url.pathname.split('/').filter(Boolean)

  if (
    (host === 'youtube.com' || host === 'm.youtube.com') &&
    path[0]?.toLowerCase() === 'shorts' &&
    Boolean(path[1])
  ) {
    return 'youtube'
  }

  if (
    (host === 'instagram.com' || host === 'www.instagram.com') &&
    ['p', 'reel', 'reels'].includes(path[0]?.toLowerCase() ?? '') &&
    Boolean(path[1])
  ) {
    return 'instagram'
  }

  return undefined
}

export function parseVideoUrl(text: string): ParsedVideoUrl | undefined {
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '')

    try {
      const url = new URL(candidate)
      const source = sourceFromUrl(url)

      if (source) {
        return { source, url: url.toString() }
      }
    } catch {
      // Ignore malformed candidates and keep looking for a supported URL.
    }
  }

  return undefined
}
