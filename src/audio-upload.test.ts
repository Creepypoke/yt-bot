import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MediaUpload } from 'gramio'

import {
  readAudioMetadata,
  sendAudioFile,
  type AudioSender,
} from './audio-upload.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
const mediaTest = Bun.which('ffmpeg') && Bun.which('ffprobe') ? test : test.skip

describe('audio upload', () => {
  mediaTest('passes the actual MP3 tags to Telegram', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-upload-'))
    directories.push(directory)
    const path = join(directory, 'Video title.mp3')
    const process = Bun.spawn(
      [
        'ffmpeg',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=duration=0.1',
        '-metadata',
        'title=Track title',
        '-metadata',
        'artist=Artist',
        path,
      ],
      { stderr: 'pipe' },
    )
    expect(await process.exited).toBe(0)
    const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
    await sendAudioFile({ sendAudio }, path, 'test')
    expect(sendAudio).toHaveBeenCalledTimes(1)
    expect(sendAudio.mock.calls[0]?.[1]).toEqual({
      title: 'Track title',
      performer: 'Artist',
    })
    expect(await readAudioMetadata(path, 'test')).toEqual({
      title: 'Track title',
      performer: 'Artist',
    })
  })

  test('does not upload after cancellation', async () => {
    const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
    const controller = new AbortController()
    controller.abort()
    await expect(
      sendAudioFile({ sendAudio }, 'unused.mp3', 'test', controller.signal),
    ).rejects.toThrow()
    expect(sendAudio).not.toHaveBeenCalled()
  })

  test('does not upload when cancelled while resolving the upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-upload-'))
    directories.push(directory)
    const path = join(directory, 'audio.mp3')
    await Bun.write(path, 'not an MP3')
    const controller = new AbortController()
    const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
    const resolvePath = MediaUpload.path.bind(MediaUpload)
    const uploadPath = spyOn(MediaUpload, 'path').mockImplementation(
      async (...args) => {
        const upload = await resolvePath(...args)
        controller.abort()
        return upload
      },
    )
    try {
      await expect(
        sendAudioFile({ sendAudio }, path, 'test', controller.signal),
      ).rejects.toThrow()
      expect(uploadPath).toHaveBeenCalledTimes(1)
      expect(sendAudio).not.toHaveBeenCalled()
    } finally {
      uploadPath.mockRestore()
    }
  })

  test('does not upload when cancelled during metadata probing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-upload-'))
    directories.push(directory)
    const started = join(directory, 'probe-started')
    // A blocking executable makes cancellation deterministic, independent of
    // how quickly the real ffprobe finishes reading a local file.
    await writeFile(
      join(directory, 'ffprobe'),
      `#!${process.execPath}\nawait Bun.write(${JSON.stringify(started)}, '')\nawait Bun.sleep(30_000)\n`,
      { mode: 0o755 },
    )
    const previous = process.env.PATH
    const controller = new AbortController()
    const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
    let pending: Promise<void> | undefined
    try {
      process.env.PATH = directory
      pending = sendAudioFile(
        { sendAudio },
        'unused.mp3',
        'test',
        controller.signal,
      )
      void pending.catch(() => {})
      for (let attempts = 0; attempts < 200; attempts++) {
        if (await Bun.file(started).exists()) break
        await Bun.sleep(5)
      }
      expect(await Bun.file(started).exists()).toBe(true)
      controller.abort()
      await expect(pending).rejects.toThrow()
      expect(sendAudio).not.toHaveBeenCalled()
    } finally {
      controller.abort()
      await pending?.catch(() => {})
      process.env.PATH = previous
    }
  })

  test('missing ffprobe is nonfatal', async () => {
    const previous = process.env.PATH
    try {
      process.env.PATH = ''
      expect(await readAudioMetadata('unused.mp3', 'test')).toEqual({})
    } finally {
      process.env.PATH = previous
    }
  })

  mediaTest(
    'omits missing tags instead of claiming they are required strings',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'audio-upload-'))
      directories.push(directory)
      const path = join(directory, 'untagged.mp3')
      const process = Bun.spawn(
        [
          'ffmpeg',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=duration=0.1',
          path,
        ],
        { stderr: 'pipe' },
      )
      expect(await process.exited).toBe(0)
      expect(await readAudioMetadata(path, 'test')).toEqual({})
    },
  )

  mediaTest('sends the audio even when metadata cannot be read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audio-upload-'))
    directories.push(directory)
    const path = join(directory, 'broken.mp3')
    await Bun.write(path, 'not an MP3')
    const sendAudio = mock<AudioSender['sendAudio']>(async () => undefined)
    await sendAudioFile({ sendAudio }, path, 'test')
    expect(sendAudio).toHaveBeenCalledTimes(1)
    expect(sendAudio.mock.calls[0]?.[1]).toEqual({})
    expect(await readAudioMetadata(path, 'test')).toEqual({})
  })
})
