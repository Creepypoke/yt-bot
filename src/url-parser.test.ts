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
})
