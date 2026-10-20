import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DownloadRequest } from './downloader.ts'
import { VkDownloader } from './vk-downloader.ts'

describe('VkDownloader', () => {
  let directory: string
  const originalSpawn = Bun.spawn
  let spawnSpy: ReturnType<typeof spyOn<typeof Bun, 'spawn'>>
  let request: DownloadRequest

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vk-downloader-test-'))
    const executable = join(directory, 'yt-dlp')
    // Exercise the real subprocess/file flow without contacting VK.
    await writeFile(
      executable,
      `#!${process.execPath}
const args = process.argv.slice(2)
const output = args[args.indexOf('--output') + 1]
await Bun.write(output + '.args.json', JSON.stringify(args))
if (args.includes('--cookies')) {
  await Bun.write(args[args.indexOf('--cookies') + 1], 'refreshed cookies')
}
if (args.includes('--skip-download')) {
  await Bun.write(output + '.info.json', JSON.stringify({formats: [
    {ext: 'mp4', height: 720},
    {ext: 'mp4', height: 360},
    {ext: 'mp4', height: 720},
    {ext: 'm4a', vcodec: 'none'},
  ]}))
} else {
  await Bun.write(output.replace('%(ext)s', args.includes('--extract-audio') ? 'mp3' : 'mp4'), 'media')
}
`,
    )
    await chmod(executable, 0o755)
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(((
      command: string[],
      options: Bun.SpawnOptions.OptionsObject<'ignore', 'ignore', 'pipe'>,
    ) =>
      originalSpawn(
        [executable, ...command.slice(1)],
        options,
      )) as typeof Bun.spawn)
    request = {
      requestId: 'vk-test',
      url: 'https://vkvideo.ru/video-123_456',
      outputDirectory: directory,
      signal: new AbortController().signal,
    }
  })

  afterEach(async () => {
    spawnSpy.mockRestore()
    await rm(directory, { recursive: true, force: true })
  })

  test('lists resolutions using independent proxy and a writable copy of cookies', async () => {
    const cookies = join(directory, 'original-cookies.txt')
    await writeFile(cookies, 'original cookies')
    const downloader = new VkDownloader(cookies, 'socks5h://vk-proxy:1080')
    expect(await downloader.getAvailableResolutions(request)).toEqual([
      360, 720,
    ])
    const args = JSON.parse(
      await readFile(join(directory, 'metadata.args.json'), 'utf8'),
    ) as string[]
    expect(args).toContain('--skip-download')
    expect(args).toContain('--no-playlist')
    expect(args).toContain('socks5h://vk-proxy:1080')
    expect(args).toContain(join(directory, 'cookies.txt'))
    expect(args).not.toContain('--extractor-args')
    expect(args.slice(-2)).toEqual(['--', request.url])
    expect(await readFile(cookies, 'utf8')).toBe('original cookies')
    expect(await readFile(join(directory, 'cookies.txt'), 'utf8')).toBe(
      'refreshed cookies',
    )
  })

  test('downloads the selected video resolution as MP4', async () => {
    const path = await new VkDownloader().download({
      ...request,
      selection: { type: 'video', height: 720, encode: false },
    })
    expect(path).toBe(join(directory, 'video.mp4'))
    const args = JSON.parse(
      await readFile(join(directory, 'video.%(ext)s.args.json'), 'utf8'),
    ) as string[]
    expect(args[args.indexOf('--format') + 1]).toBe(
      'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]',
    )
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4')
    expect(args).not.toContain('--proxy')
    expect(args).not.toContain('--cookies')
    expect(args).not.toContain('--extractor-args')
  })

  test('extracts MP3 audio', async () => {
    const path = await new VkDownloader().download({
      ...request,
      selection: { type: 'audio' },
    })
    expect(path).toBe(join(directory, 'video.mp3'))
    const args = JSON.parse(
      await readFile(join(directory, 'video.%(ext)s.args.json'), 'utf8'),
    ) as string[]
    expect(args).toContain('--extract-audio')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
    expect(args).not.toContain('--format')
  })
})
