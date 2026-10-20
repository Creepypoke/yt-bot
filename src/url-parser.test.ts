import { describe, expect, test } from 'bun:test'

import { parseVideoUrl } from './url-parser.ts'

describe('parseVideoUrl', () => {
  test('parses a YouTube Shorts URL inside text', () => {
    expect(
      parseVideoUrl('Посмотри: https://www.youtube.com/shorts/abc_123?si=test'),
    ).toEqual({
      source: 'youtube',
      url: 'https://www.youtube.com/shorts/abc_123?si=test',
    })
  })

  test('parses an Instagram Reel URL and trims punctuation', () => {
    expect(parseVideoUrl('https://instagram.com/reel/ABC123/).')).toEqual({
      source: 'instagram',
      url: 'https://instagram.com/reel/ABC123/',
    })
  })

  test('parses an Instagram Reel URL and trims punctuation', () => {
    expect(parseVideoUrl('https://www.instagram.com/p/Db-R7ROoBkf/')).toEqual({
      source: 'instagram',
      url: 'https://www.instagram.com/p/Db-R7ROoBkf/',
    })
  })

  test('rejects regular YouTube videos', () => {
    expect(parseVideoUrl('https://youtube.com/watch?v=abc')).toBeUndefined()
    expect(parseVideoUrl('https://youtu.be/abc')).toBeUndefined()
  })

  test('parses regular YouTube videos when explicitly allowed', () => {
    expect(
      parseVideoUrl('https://www.youtube.com/watch?v=abc_123&t=10', true),
    ).toEqual({
      source: 'youtube',
      url: 'https://www.youtube.com/watch?v=abc_123&t=10',
      isLongYouTubeVideo: true,
    })
    expect(
      parseVideoUrl('Посмотри https://youtu.be/abc_123?si=test', true),
    ).toEqual({
      source: 'youtube',
      url: 'https://youtu.be/abc_123?si=test',
      isLongYouTubeVideo: true,
    })
    expect(
      parseVideoUrl('https://m.youtube.com/watch?v=abc_123', true),
    ).toEqual({
      source: 'youtube',
      url: 'https://m.youtube.com/watch?v=abc_123',
      isLongYouTubeVideo: true,
    })
  })

  test('rejects unsupported hosts that contain a supported name', () => {
    expect(
      parseVideoUrl('https://youtube.com.example.org/shorts/abc'),
    ).toBeUndefined()
  })

  test('parses VK videos on supported domains for admins', () => {
    for (const host of [
      'vk.ru',
      'vkvideo.ru',
      'vk.com',
      'm.vk.ru',
      'm.vkvideo.ru',
      'm.vk.com',
    ]) {
      for (const id of ['-123_456', '123_456']) {
        const url = `https://${host}/video${id}?list=abc123&t=10`
        expect(parseVideoUrl(`Смотри: ${url}).`, true)).toEqual({
          source: 'vk',
          url,
        })
        expect(parseVideoUrl(url)).toBeUndefined()
      }
    }
  })

  test('normalizes www VK hosts for yt-dlp', () => {
    expect(parseVideoUrl('https://www.vkvideo.ru/video-123_456', true)).toEqual(
      {
        source: 'vk',
        url: 'https://vkvideo.ru/video-123_456',
      },
    )
  })

  test('extracts a VK video from a feed link', () => {
    expect(
      parseVideoUrl('https://vk.ru/feed?z=video-123_456%2Fpl_-123_-2', true),
    ).toEqual({
      source: 'vk',
      url: 'https://vk.ru/video-123_456',
    })
  })

  test('preserves VK embedded video parameters', () => {
    const url = 'https://vkvideo.ru/video_ext.php?oid=-123&id=456&hash=abc'
    expect(parseVideoUrl(url, true)).toEqual({ source: 'vk', url })
  })

  test('rejects invalid VK links, profiles, playlists and lookalike hosts', () => {
    for (const url of [
      'https://vk.ru/video',
      'https://vkvideo.ru/video-123_abc',
      'https://vkvideo.ru/video-123_456/other',
      'https://vkvideo.ru/playlist/-123_456',
      'https://vk.ru/id123',
      'https://vk.ru/video_ext.php?oid=-123',
      'https://vk.ru/video_ext.php?oid=abc&id=456',
      'https://vk.ru/feed?z=video-123_456oops',
      'https://vk.ru.example.org/video-123_456',
      'https://fakevkvideo.ru/video-123_456',
    ]) {
      expect(parseVideoUrl(url, true)).toBeUndefined()
    }
  })
})
