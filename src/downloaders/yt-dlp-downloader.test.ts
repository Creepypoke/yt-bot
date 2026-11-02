import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { YtDlpDownloader } from './yt-dlp-downloader.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('YtDlpDownloader audio', () => {
  test('embeds metadata and uses a Unicode video title as the MP3 filename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-metadata-'))
    directories.push(directory)
    await writeFile(join(directory, 'Название ролика.mp3'), '')
    const spawn = spyOn(Bun, 'spawn').mockReturnValue({
      exited: Promise.resolve(0),
      stderr: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      kill() {},
    } as unknown as ReturnType<typeof Bun.spawn>)

    try {
      const path = await new YtDlpDownloader().download({
        requestId: 'audio-test',
        url: 'https://www.youtube.com/watch?v=test',
        outputDirectory: directory,
        signal: new AbortController().signal,
        selection: { type: 'audio' },
      })
      const command = spawn.mock.calls[0]![0] as string[]
      expect(command).toContain('--embed-metadata')
      expect(command).toContain('--windows-filenames')
      expect(command).not.toContain('--restrict-filenames')
      expect(command).not.toContain('--write-info-json')
      expect(command[command.indexOf('--output') + 1]).toBe(
        join(directory, '%(title).180B.%(ext)s'),
      )
      expect(path).toBe(join(directory, 'Название ролика.mp3'))
    } finally {
      spawn.mockRestore()
    }
  })
})

for (const selection of [
  undefined,
  { type: 'video' as const, height: 720, encode: false },
]) {
  test(`video command retains MP4 and ${selection?.height ?? 480}p limit`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-regression-'))
    directories.push(directory)
    await writeFile(join(directory, 'video.mp4'), '')
    const spawn = spyOn(Bun, 'spawn').mockReturnValue({
      exited: Promise.resolve(0),
      stderr: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      kill() {},
    } as unknown as ReturnType<typeof Bun.spawn>)
    try {
      const path = await new YtDlpDownloader().download({
        requestId: 'video-test',
        url: 'https://example.com/video',
        outputDirectory: directory,
        signal: new AbortController().signal,
        selection,
      })
      const command = spawn.mock.calls[0]![0] as string[]
      expect(command).toContain('--restrict-filenames')
      expect(command).not.toContain('--windows-filenames')
      expect(command).not.toContain('--embed-metadata')
      expect(command).not.toContain('--write-info-json')
      expect(command[command.indexOf('--merge-output-format') + 1]).toBe('mp4')
      expect(command[command.indexOf('--format') + 1]).toContain(
        `height<=${selection?.height ?? 480}`,
      )
      expect(path).toBe(join(directory, 'video.mp4'))
    } finally {
      spawn.mockRestore()
    }
  })
}
