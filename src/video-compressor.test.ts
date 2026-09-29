import { describe, expect, test } from 'bun:test'

import {
  buildCompressionCommand,
  buildVideoTranscodingCommand,
} from './video-compressor.ts'

describe('buildCompressionCommand', () => {
  test('creates a Telegram-compatible 480px-wide MP4 command', () => {
    const command = buildCompressionCommand('input.webm', 'output.mp4')

    expect(command[0]).toBe('ffmpeg')
    expect(command).toContain("scale='trunc(min(480,iw)/2)*2':-2")
    expect(command).toContain('libx264')
    expect(command).toContain('yuv420p')
    expect(command).toContain('aac')
    expect(command.at(-1)).toBe('output.mp4')
  })

  test('keeps paths as individual process arguments', () => {
    const command = buildCompressionCommand(
      'folder with spaces/input.mov',
      'another folder/output.mp4',
    )

    expect(command).toContain('folder with spaces/input.mov')
    expect(command.at(-1)).toBe('another folder/output.mp4')
  })

  test('creates a Telegram-compatible command without resizing video', () => {
    const command = buildVideoTranscodingCommand('input.webm', 'output.mp4')

    expect(command).not.toContain('-vf')
    expect(command).toContain('libx264')
    expect(command).toContain('yuv420p')
    expect(command).toContain('aac')
    expect(command.at(-1)).toBe('output.mp4')
  })
})
