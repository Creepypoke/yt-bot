import { resolve } from 'node:path'

import env from 'env-var'

export const config = {
  NODE_ENV: env
    .get('NODE_ENV')
    .default('development')
    .asEnum(['production', 'test', 'development']),
  LOG_LEVEL: env
    .get('LOG_LEVEL')
    .default('info')
    .asEnum(['debug', 'info', 'warn', 'error']),
  BOT_TOKEN: env.get('BOT_TOKEN').required().asString(),
  DOWNLOAD_DIR: resolve(
    env.get('DOWNLOAD_DIR').default('./downloads').asString(),
  ),
  // Bytes. Telegram's own upload limit may be lower than this value.
  MAX_FILE_SIZE: env.get('MAX_FILE_SIZE').default('50000000').asIntPositive(),
  // Transcode every downloaded video to an MP4 no wider than 480 pixels.
  COMPRESS_TO_480P: env.get('COMPRESS_TO_480P').default('true').asBoolStrict(),
  HEALTHCHECK_PORT: env.get('HEALTHCHECK_PORT').default('3000').asPortNumber(),
  BOT_ADMIN_IDS: env
    .get('BOT_ADMIN_IDS')
    .default('')
    .asString()
    .split(',')
    .flatMap((value) => {
      const id = Number(value.trim())
      return Number.isSafeInteger(id) && id > 0 ? [id] : []
    }),
  INSTAGRAM_COOKIES: env.get('INSTAGRAM_COOKIES').asString(),
  INSTAGRAM_PROXY: env.get('INSTAGRAM_PROXY').asString(),
  YOUTUBE_COOKIES: env.get('YOUTUBE_COOKIES').asString(),
  YOUTUBE_PROXY: env.get('YOUTUBE_PROXY').asString(),
}
