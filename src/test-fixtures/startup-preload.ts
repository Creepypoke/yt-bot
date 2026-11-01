import { bot } from '../bot.ts'

// Fault injection only in subprocess tests; production uses no preload.
process.on('message', (message) => {
  if (message === 'hold-stop') {
    const stop = bot.stop.bind(bot)
    bot.stop = async () => {
      await Bun.sleep(250)
      await stop()
    }
    process.send?.('holding-stop')
  } else if (message === 'uncaught') {
    setTimeout(() => {
      throw new Error('injected fatal exception')
    }, 0)
  } else if (message === 'rejection') {
    void Promise.reject(new Error('injected fatal rejection'))
  }
})
