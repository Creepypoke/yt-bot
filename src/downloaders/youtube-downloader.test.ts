import { describe, expect, test } from 'bun:test'

import {
  buildYouTubeFormatSelector,
  extractAvailableResolutions,
} from './youtube-downloader.ts'

describe('YouTubeDownloader helpers', () => {
  test('limits every video fallback to the selected resolution', () => {
    expect(buildYouTubeFormatSelector(720)).toBe(
      'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]',
    )
  })

  test('extracts unique sorted MP4 video resolutions', () => {
    expect(
      extractAvailableResolutions({
        formats: [
          { ext: 'mp4', height: 720, vcodec: 'avc1' },
          { ext: 'webm', height: 1080, vcodec: 'vp9' },
          { ext: 'mp4', height: 360, vcodec: 'avc1' },
          { ext: 'mp4', height: 720, vcodec: 'avc1' },
          { ext: 'mp4', vcodec: 'none' },
        ],
      }),
    ).toEqual([360, 720])
  })
})
