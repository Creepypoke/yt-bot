import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { YtDlpDownloader } from './yt-dlp-downloader.ts'

const mediaTest =
  Bun.which('yt-dlp') && Bun.which('ffmpeg') && Bun.which('ffprobe')
    ? test
    : test.skip

mediaTest(
  'MP3 files contain source metadata and retain safe Unicode video titles',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-integration-'))
    const source = join(directory, 'source.wav')
    const generate = Bun.spawn(
      [
        'ffmpeg',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.2',
        source,
      ],
      { stderr: 'pipe' },
    )
    expect(await generate.exited).toBe(0)
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        return new Response(Bun.file(source))
      },
    })
    const realSpawn = Bun.spawn.bind(Bun)

    try {
      for (const artist of ['Исполнитель', undefined]) {
        const outputDirectory = join(directory, artist ? 'music' : 'channel')
        const title = artist
          ? 'Название ролика — 音楽 🎵'
          : 'Видео / с : опасными ? символами'
        const infoPath = join(directory, 'source.info.json')
        // A local source fixture exercises real yt-dlp/FFmpeg without relying on YouTube access.
        await writeFile(
          infoPath,
          JSON.stringify({
            id: 'fixture',
            title,
            track: 'Different track title',
            artist,
            uploader: 'Автор канала',
            album: 'Альбом',
            upload_date: '20261031',
            description: 'Описание ролика',
            webpage_url: 'https://example.com/watch/fixture',
            extractor: 'generic',
            extractor_key: 'Generic',
            ext: 'wav',
            url: `http://127.0.0.1:${server.port}/source.wav`,
          }),
        )
        const spawn = spyOn(Bun, 'spawn').mockImplementation(((
          command: string[],
          options: object,
        ) => {
          if (command[0] === 'yt-dlp') {
            return realSpawn(
              [
                ...command.slice(0, command.indexOf('--')),
                '--load-info-json',
                infoPath,
              ],
              options,
            )
          }
          return realSpawn(command, options)
        }) as typeof Bun.spawn)
        let path: string
        try {
          path = await new YtDlpDownloader().download({
            requestId: 'integration',
            url: 'https://example.com/watch/fixture',
            outputDirectory,
            signal: new AbortController().signal,
            selection: { type: 'audio' },
          })
        } finally {
          spawn.mockRestore()
        }
        expect(basename(path)).toBe(
          artist ? `${title}.mp3` : 'Видео ⧸ с ： опасными ？ символами.mp3',
        )
        const probe = realSpawn(
          ['ffprobe', '-v', 'error', '-show_format', '-of', 'json', path],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        const metadata = (await new Response(probe.stdout).json()) as {
          format: { tags: Record<string, string> }
        }
        expect(await probe.exited).toBe(0)
        expect(metadata.format.tags.title).toBe(title)
        expect(metadata.format.tags.artist).toBe(artist ?? 'Автор канала')
        expect(metadata.format.tags.album).toBe('Альбом')
        expect(metadata.format.tags.date).toBe('20261031')
        expect(metadata.format.tags.description).toBe('Описание ролика')
        expect(metadata.format.tags.purl).toBe(
          'https://example.com/watch/fixture',
        )
      }
    } finally {
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
