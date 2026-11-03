import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { MediaUpload } from 'gramio'

import { logger } from './logger.ts'

const execFileAsync = promisify(execFile)
export interface AudioMetadata {
  title?: string
  performer?: string
}

export interface AudioSender {
  sendAudio(
    audio: Awaited<ReturnType<typeof MediaUpload.path>>,
    metadata: AudioMetadata,
  ): Promise<unknown>
}

/** Read the final file, not extractor fields: Telegram and MP3 share one metadata policy. */
export async function readAudioMetadata(
  path: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<AudioMetadata> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format_tags=title,artist',
        '-of',
        'json',
        path,
      ],
      { timeout: 5_000, maxBuffer: 64 * 1024, signal },
    )
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object' || !('format' in parsed))
      return {}
    const format = parsed.format
    if (!format || typeof format !== 'object' || !('tags' in format)) return {}
    const tags = format.tags
    if (!tags || typeof tags !== 'object') return {}
    const metadata: AudioMetadata = {}
    if ('title' in tags && typeof tags.title === 'string' && tags.title.trim())
      metadata.title = tags.title.trim()
    if (
      'artist' in tags &&
      typeof tags.artist === 'string' &&
      tags.artist.trim()
    )
      metadata.performer = tags.artist.trim()
    return metadata
  } catch (error) {
    // Metadata is optional. Missing ffprobe, invalid files and timeouts must not block upload.
    logger.debug('download.audio.metadata.read_failed', { requestId, error })
    return {}
  }
}

export async function sendAudioFile(
  context: AudioSender,
  path: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<void> {
  const metadata = await readAudioMetadata(path, requestId, signal)
  signal?.throwIfAborted()
  const audio = await MediaUpload.path(path)
  signal?.throwIfAborted()
  await context.sendAudio(audio, metadata)
}
