import { expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { sendAudioFile, type AudioSender } from '../audio-upload.ts'
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
      for (const [index, item] of [
        { artist: 'Исполнитель', track: 'Different track title' },
        { artist: undefined, track: undefined },
        { artist: '', track: '' },
        { artist: '  ', track: '  ' },
        { artist: undefined, track: 'Трек без артиста' },
        { artist: '', track: undefined, creator: 'Композитор' },
        { artist: undefined, track: undefined, artists: ['Первый', 'Второй'] },
        { artist: undefined, track: undefined, artists: ['', '  '] },
        { artist: undefined, track: undefined, creators: ['', '  '] },
        {
          artist: undefined,
          track: undefined,
          artists: ['', 'Первый', '  ', 'Второй', ''],
        },
        {
          artist: undefined,
          track: undefined,
          creators: ['', 'Первый', '  ', 'Второй', ''],
        },
        {
          artist: 'Сольный артист',
          track: undefined,
          artists: ['', 'Первый', '  ', 'Второй'],
          creator: 'Композитор',
          creators: ['Создатель'],
        },
        {
          artist: undefined,
          track: undefined,
          artists: ['', '  '],
          creator: 'Композитор',
          creators: ['', 'Создатель'],
        },
        {
          artist: undefined,
          track: undefined,
          artists: ['', 'Первый', '  ', 'Второй'],
          creator: 'Композитор',
        },
        {
          artist: undefined,
          track: undefined,
          artists: ['', '  '],
          creators: ['', 'Первый', '  ', 'Второй'],
        },
        {
          artist: undefined,
          track: undefined,
          uploader: '',
          channel: 'Резервный канал',
        },
        {
          artist: undefined,
          track: undefined,
          title: 'Длинное название '.repeat(40),
        },
      ].entries()) {
        const { artist, track } = item
        const outputDirectory = join(directory, String(index))
        const title =
          ('title' in item ? item.title : undefined) ??
          (artist
            ? 'Название ролика — 音楽 🎵'
            : 'Видео / с : опасными ? символами')
        const infoPath = join(directory, 'source.info.json')
        // A local source fixture exercises real yt-dlp/FFmpeg without relying on YouTube access.
        await writeFile(
          infoPath,
          JSON.stringify({
            id: 'fixture',
            title,
            uploader: 'Автор канала',
            ...item,
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
        if ('title' in item) {
          expect(Buffer.byteLength(basename(path))).toBeLessThanOrEqual(184)
          expect(basename(path).endsWith('.mp3')).toBe(true)
        } else {
          expect(basename(path)).toBe(
            artist ? `${title}.mp3` : 'Видео ⧸ с ： опасными ？ символами.mp3',
          )
        }
        const probe = realSpawn(
          ['ffprobe', '-v', 'error', '-show_format', '-of', 'json', path],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        const metadata = (await new Response(probe.stdout).json()) as {
          format: { tags: Record<string, string> }
        }
        expect(await probe.exited).toBe(0)
        expect(metadata.format.tags.title).toBe(track?.trim() || title.trim())
        expect(metadata.format.tags.artist).toBe(
          artist?.trim() ||
            ('artists' in item
              ? item.artists?.filter((value) => value.trim()).join(', ')
              : undefined) ||
            ('creator' in item ? item.creator : undefined) ||
            ('creators' in item
              ? item.creators?.filter((value) => value.trim()).join(', ')
              : undefined) ||
            ('channel' in item ? item.channel : undefined) ||
            'Автор канала',
        )
        const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
        await sendAudioFile({ sendAudio }, path, 'integration')
        expect(sendAudio).toHaveBeenCalledTimes(1)
        expect(sendAudio.mock.calls[0]?.[1]).toEqual({
          title: metadata.format.tags.title?.trim(),
          performer: metadata.format.tags.artist,
        })
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
