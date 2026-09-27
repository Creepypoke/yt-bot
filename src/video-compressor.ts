import { join } from 'node:path'

import { runDownloader } from './downloaders/cli.ts'

const MAX_VIDEO_WIDTH = 480

export function buildCompressionCommand(
  inputPath: string,
  outputPath: string,
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
    '-vf',
    `scale='trunc(min(${MAX_VIDEO_WIDTH},iw)/2)*2':-2`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '28',
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
