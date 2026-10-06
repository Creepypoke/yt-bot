import { join } from 'node:path'

import { runDownloader } from './downloaders/cli.ts'

const MAX_VIDEO_WIDTH = 480
const TRANSCODING_SIZE_MARGIN = 0.94
const AUDIO_BITRATE = 128_000

export function calculateVideoBitrate(
  durationSeconds: number,
  targetFileSizeBytes: number,
): number {
  const totalBitrate = Math.floor((targetFileSizeBytes * 8) / durationSeconds)
  return Math.floor((totalBitrate - AUDIO_BITRATE) * TRANSCODING_SIZE_MARGIN)
}

export function buildVideoTranscodingCommand(
  inputPath: string,
  outputPath: string,
  videoFilter?: string,
  videoBitrate?: number,
): string[] {
  return [
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    ...(videoFilter ? ['-vf', videoFilter] : []),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    ...(videoBitrate
      ? [
          '-b:v',
          String(videoBitrate),
          '-maxrate',
          String(videoBitrate),
          '-bufsize',
          String(videoBitrate * 2),
        ]
      : ['-crf', '28']),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ]
}

export function buildCompressionCommand(
  inputPath: string,
  outputPath: string,
): string[] {
  return buildVideoTranscodingCommand(
    inputPath,
    outputPath,
    `scale='trunc(min(${MAX_VIDEO_WIDTH},iw)/2)*2':-2`,
  )
}

export async function compressVideoTo480p(
  inputPath: string,
  outputDirectory: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  const outputPath = join(outputDirectory, 'video-480p.mp4')
  await runDownloader(
    buildCompressionCommand(inputPath, outputPath),
    requestId,
    signal,
  )
  return outputPath
}

export async function transcodeVideoForTelegram(
  inputPath: string,
  outputDirectory: string,
  requestId: string,
  signal: AbortSignal,
  targetFileSizeBytes?: number,
): Promise<string> {
  let videoBitrate: number | undefined

  if (targetFileSizeBytes) {
    const durationSeconds = await getMediaDuration(inputPath, signal)
    videoBitrate = calculateVideoBitrate(durationSeconds, targetFileSizeBytes)

    if (videoBitrate < 100_000) {
      throw new Error('Video is too long to fit within Telegram upload limits')
    }
  }

  const outputPath = join(outputDirectory, 'video-compatible.mp4')
  await runDownloader(
    buildVideoTranscodingCommand(inputPath, outputPath, undefined, videoBitrate),
    requestId,
    signal,
  )
  return outputPath
}

async function getMediaDuration(
  inputPath: string,
  signal: AbortSignal,
): Promise<number> {
  const process = Bun.spawn(
    [
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  )
  const abortProcess = () => process.kill()
  signal.addEventListener('abort', abortProcess, { once: true })

  const [exitCode, output] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ])
  signal.removeEventListener('abort', abortProcess)

  const durationSeconds = Number(output.trim())
  if (
    exitCode !== 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error('Could not determine video duration')
  }

  return durationSeconds
}
