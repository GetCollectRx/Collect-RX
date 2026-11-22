/**
 * The desktop app's built-in server forwards /ws to the API. The API sends its
 * first message right behind its handshake reply, so those bytes arrive at the
 * proxy together with the 101 response. They must go to the client. They used
 * to be written back to the API, which read its own unmasked server frame as
 * client input and crashed with "MASK must be set".
 *
 * The upstream here is a real ws server that records any error it raises, so a
 * regression shows up as a recorded error and a missing message.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

interface DesktopServer {
  startDesktopServer: (opts: {
    distDir: string
    apiOrigin: string
    port?: number
  }) => Promise<{ port: number; close: () => Promise<void> }>
}

const { startDesktopServer } = createRequire(import.meta.url)('../electron-shell/desktopServer.cjs') as DesktopServer

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function startUpstream(onConnection: (ws: WebSocket) => void) {
  const server = http.createServer()
  const wss = new WebSocketServer({ server })
  const errors: string[] = []
  wss.on('connection', (ws) => {
    ws.on('error', (err) => errors.push(err.message))
    onConnection(ws)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((c) => c.terminate())
        server.close(() => resolve())
      }),
  )
  return { port, errors }
}

async function startDesktop(apiPort: number) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-desktop-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>desktop</title>')
  const port = 19000 + Math.floor(Math.random() * 900)
  const handle = await startDesktopServer({ distDir, apiOrigin: `http://127.0.0.1:${apiPort}`, port })
  cleanups.push(() => handle.close())
  return handle.port
}

function nextMessage(client: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    client.once('message', (data) => resolve(data.toString()))
    client.once('error', reject)
  })
}

describe('desktop server /ws proxy', () => {
  it('delivers a message the API sends immediately after the handshake to the client', async () => {
    const upstream = await startUpstream((ws) => ws.send('connected-now'))
    const desktopPort = await startDesktop(upstream.port)

    const client = new WebSocket(`ws://127.0.0.1:${desktopPort}/ws/desk`)
    cleanups.push(() => client.terminate())

    await expect(nextMessage(client)).resolves.toBe('connected-now')
    await new Promise((r) => setTimeout(r, 200))
    expect(upstream.errors).toEqual([])
  })

  it('does not feed the API its own frames back, so the upstream connection stays open', async () => {
    let closedUpstream = false
    const upstream = await startUpstream((ws) => {
      ws.send('first')
      ws.on('close', () => {
        closedUpstream = true
      })
    })
    const desktopPort = await startDesktop(upstream.port)

    const client = new WebSocket(`ws://127.0.0.1:${desktopPort}/ws/desk`)
    cleanups.push(() => client.terminate())
    await nextMessage(client)
    await new Promise((r) => setTimeout(r, 300))

    expect(client.readyState).toBe(WebSocket.OPEN)
    expect(closedUpstream).toBe(false)
    expect(upstream.errors).toEqual([])
  })

  it('still carries messages from the client to the API', async () => {
    const received: string[] = []
    const upstream = await startUpstream((ws) => {
      ws.on('message', (data) => received.push(data.toString()))
    })
    const desktopPort = await startDesktop(upstream.port)

    const client = new WebSocket(`ws://127.0.0.1:${desktopPort}/ws/desk`)
    cleanups.push(() => client.terminate())
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })
    client.send('hello-from-client')
    await new Promise((r) => setTimeout(r, 200))

    expect(received).toEqual(['hello-from-client'])
  })
})
