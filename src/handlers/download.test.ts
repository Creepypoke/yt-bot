import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readAudioMetadata } from './download.ts'

describe('readAudioMetadata', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'audio-metadata-test-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  test('reads title and artist from the info.json beside the audio file', async () => {
    const audioPath = join(directory, 'Some Video.mp3')
    await writeFile(
      audioPath.replace(/\.mp3$/, '.info.json'),
      JSON.stringify({
        title: 'Some Video',
        artist: 'Some Uploader',
      }),
    )

    expect(await readAudioMetadata(audioPath, 'req')).toEqual({
      title: 'Some Video',
      performer: 'Some Uploader',
    })
  })

  test('falls back through artist, uploader and channel', async () => {
    const audioPath = join(directory, 'Fallback.mp3')
    await writeFile(
      audioPath.replace(/\.mp3$/, '.info.json'),
      JSON.stringify({ channel: 'Some Channel' }),
    )

    const result = await readAudioMetadata(audioPath, 'req')
    expect(result).not.toBeNull()
    expect(result?.performer).toBe('Some Channel')
    expect(result?.title).toBeUndefined()
  })

  test('returns null when the audio file has no info.json', async () => {
    const audioPath = join(directory, 'NoMetadata.mp3')
    await writeFile(audioPath, 'audio')

    expect(await readAudioMetadata(audioPath, 'req')).toBeNull()
  })

  test('returns null when the info.json is invalid JSON', async () => {
    const audioPath = join(directory, 'Broken.mp3')
    await writeFile(audioPath.replace(/\.mp3$/, '.info.json'), 'not-json{')

    expect(await readAudioMetadata(audioPath, 'req')).toBeNull()
  })

  test('returns null when the info.json has no title or performer', async () => {
    const audioPath = join(directory, 'Empty.mp3')
    await writeFile(
      audioPath.replace(/\.mp3$/, '.info.json'),
      JSON.stringify({ duration: 123 }),
    )

    expect(await readAudioMetadata(audioPath, 'req')).toBeNull()
  })
})
