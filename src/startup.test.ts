import { expect, test } from 'bun:test'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(10)
  }
  throw new Error('Timed out waiting for startup condition')
}

function freePort() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  })
  const port = server.port!
  server.stop(true)
  return port
}

function launch(apiPort: number, retryMs = 50) {
  const healthPort = freePort()
  let logs = ''
  let holdingStop = false
  const command = [
    process.execPath,
    '--preload',
    './src/test-fixtures/startup-preload.ts',
    'src/index.ts',
  ]
  const child = Bun.spawn(command, {
    ipc(message) {
      if (message === 'holding-stop') holdingStop = true
    },
    cwd: import.meta.dir + '/..',
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: 'test',
      BOT_TOKEN: '123456:dummy-test-token',
      TELEGRAM_API_BASE_URL: `http://127.0.0.1:${apiPort}/bot`,
      TELEGRAM_POLL_RETRY_MS: String(retryMs),
      HEALTHCHECK_PORT: String(healthPort),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of stream) logs += decoder.decode(chunk, { stream: true })
  }
  const output = Promise.all([collect(child.stdout), collect(child.stderr)])
  return {
    child,
    holdStop: async () => {
      child.send('hold-stop')
      await waitFor(() => holdingStop)
    },
    logs: () => logs,
    health: async (path = '/healthz') => {
      try {
        return (await fetch(`http://127.0.0.1:${healthPort}${path}`)).status
      } catch {
        return 0
      }
    },
    close: async () => {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      await output
    },
  }
}

function fakeApi(port = 0) {
  let available = false
  let releaseGetMe: (() => void) | undefined
  let gate: Promise<void> | undefined
  const calls: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const method = new URL(request.url).pathname.split('/').at(-1)!
      calls.push(method)
      if (method === 'getMe' && gate) await gate
      if (!available) {
        return Response.json(
          { ok: false, error_code: 502, description: 'API starting' },
          { status: 502 },
        )
      }
      if (method === 'getUpdates') await pause(20)
      return Response.json({
        ok: true,
        result: method === 'getMe'
          ? {
              id: 123456,
              is_bot: true,
              first_name: 'Test',
              username: 'startup_test_bot',
            }
          : method === 'getUpdates' ? [] : true,
      })
    },
  })
  return {
    server,
    calls,
    recover: () => {
      available = true
    },
    holdGetMe: () => {
      gate = new Promise<void>((resolve) => {
        releaseGetMe = resolve
      })
    },
    releaseGetMe: () => {
      gate = undefined
      releaseGetMe?.()
    },
  }
}

test('recovers startup after the local API becomes available without restarting', async () => {
  const api = fakeApi()
  const app = launch(api.server.port!)
  try {
    await waitFor(() => api.calls.includes('getMe'))
    await waitFor(async () => (await app.health()) !== 0)
    const initialHealth = await app.health()
    api.recover()
    await waitFor(() => api.calls.includes('getUpdates'))
    expect(initialHealth).toBe(503)
    expect(await app.health()).toBe(200)
    expect(app.logs()).toContain('bot.startup.retry')
    expect(app.logs()).toContain('bot.started')
  } finally {
    await app.close()
    api.server.stop(true)
  }
})

test('shutdown during a pending retry never starts polling', async () => {
  const api = fakeApi()
  const app = launch(api.server.port!, 80)
  try {
    await waitFor(() => app.logs().includes('bot.startup.retry'))
    await app.holdStop()
    app.child.kill('SIGTERM')
    await waitFor(() => app.logs().includes('bot.shutdown.started'))
    expect(await app.health()).toBe(503)
    api.recover()
    await waitFor(() => app.child.exitCode !== null)
    expect(await app.child.exited).toBe(0)
    expect(api.calls).not.toContain('getUpdates')
    expect(app.logs()).not.toContain('bot.started')
  } finally {
    await app.close()
    api.server.stop(true)
  }
})

test('shutdown cancels an in-flight startup before it can start polling', async () => {
  const api = fakeApi()
  api.recover()
  api.holdGetMe()
  const app = launch(api.server.port!)
  try {
    await waitFor(() => api.calls.includes('getMe'))
    await app.holdStop()
    app.child.kill('SIGINT')
    await waitFor(() => app.logs().includes('bot.shutdown.started'))
    expect(await app.health()).toBe(503)
    api.releaseGetMe()
    await waitFor(() => app.child.exitCode !== null)
    expect(await app.child.exited).toBe(0)
    expect(api.calls).not.toContain('getUpdates')
    expect(app.logs()).not.toContain('bot.started')
  } finally {
    api.releaseGetMe()
    await app.close()
    api.server.stop(true)
  }
})

test('a stalled startup request times out and retries without overlapping polling', async () => {
  const api = fakeApi()
  api.recover()
  api.holdGetMe()
  const app = launch(api.server.port!)
  try {
    await waitFor(() => api.calls.includes('getMe'))
    expect(await app.health()).toBe(503)
    await waitFor(() => app.logs().includes('bot.startup.retry'), 32000)
    api.releaseGetMe()
    await waitFor(() => api.calls.filter((method) => method === 'getMe').length >= 2)
    await waitFor(() => api.calls.includes('getUpdates'))
    expect(await app.health()).toBe(200)
    expect(app.logs().split('"event":"bot.started"')).toHaveLength(2)
  } finally {
    api.releaseGetMe()
    await app.close()
    api.server.stop(true)
  }
}, 36000)

for (const fault of ['uncaught', 'rejection']) {
  test(`fatal ${fault} exits nonzero instead of remaining healthy`, async () => {
    const api = fakeApi()
    api.recover()
    const app = launch(api.server.port!)
    try {
      await waitFor(async () => (await app.health()) === 200)
      expect(api.calls).toContain('getUpdates')
      app.child.send(fault)
      await waitFor(() => app.logs().includes('process.un'))
      await pause(100)
      expect(app.child.exitCode).toBe(1)
      expect(await app.health()).not.toBe(200)
    } finally {
      await app.close()
      api.server.stop(true)
    }
  })
}

test('recovers from an initially refused connection when the API starts later', async () => {
  const apiPort = freePort()
  const app = launch(apiPort)
  let api: ReturnType<typeof fakeApi> | undefined
  try {
    await waitFor(() => app.logs().includes('bot.startup.retry'))
    expect(await app.health()).toBe(503)
    api = fakeApi(apiPort)
    api.recover()
    await waitFor(() => api!.calls.includes('getUpdates'))
    expect(await app.health()).toBe(200)
    expect(app.child.exitCode).toBeNull()
  } finally {
    await app.close()
    api?.server.stop(true)
  }
})

test('successful startup becomes unready throughout graceful shutdown', async () => {
  const api = fakeApi()
  api.recover()
  const app = launch(api.server.port!)
  try {
    await waitFor(() => api.calls.includes('getUpdates'))
    expect(await app.health()).toBe(200)
    expect(await app.health('/missing')).toBe(404)
    expect(app.logs()).not.toContain('bot.startup.retry')
    await app.holdStop()
    app.child.kill('SIGTERM')
    await waitFor(() => app.logs().includes('bot.shutdown.started'))
    app.child.kill('SIGINT')
    expect(await app.health()).toBe(503)
    await waitFor(() => app.child.exitCode !== null)
    expect(await app.child.exited).toBe(0)
    expect(app.logs().split('"event":"bot.shutdown.started"')).toHaveLength(2)
  } finally {
    await app.close()
    api.server.stop(true)
  }
})

test('shutdown does not wait for a long pending retry delay', async () => {
  const api = fakeApi()
  const app = launch(api.server.port!, 60000)
  try {
    await waitFor(() => app.logs().includes('bot.startup.retry'))
    app.child.kill('SIGTERM')
    await waitFor(() => app.child.exitCode !== null, 1000)
    expect(await app.child.exited).toBe(0)
    expect(api.calls).toEqual(['getMe'])
  } finally {
    await app.close()
    api.server.stop(true)
  }
})
