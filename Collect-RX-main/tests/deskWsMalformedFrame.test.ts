/**
 * One bad connection must never take the API process down. A client that sends
 * a frame the protocol forbids (here, an unmasked client frame) makes ws emit
 * 'error' on that socket; without a listener Node rethrows it as an uncaught
 * exception and the whole server dies for every practice. Kept in its own file
 * for the same module-mock isolation reason as deskWsShutdown.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('desk WebSocket with a malformed frame', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../src/server/authToken.js', () => ({
      COOKIE_NAME: 'crx_access',
      verifyAuthToken: () => ({ sub: 'user-1' }),
    }))
    vi.doMock('../src/server/accessControl/types.js', () => ({
      getUserRole: () => 'front_desk',
      authPracticeId: () => 'practice-1',
    }))
  })

  it('drops only that connection and keeps serving others', async () => {
    const http = await import('node:http')
    const net = await import('node:net')
    const { WebSocket } = await import('ws')
    const mod = await import('../src/server/frontDesk/deskWs.js')

    const uncaught: Error[] = []
    const onUncaught = (err: Error) => uncaught.push(err)
    process.on('uncaughtException', onUncaught)

    const server = http.createServer()
    mod.attachDeskWebSocket(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      // Complete a real handshake, then send an unmasked text frame, which a
      // client is never allowed to send.
      const raw = net.connect(port, '127.0.0.1')
      await new Promise<void>((resolve, reject) => {
        raw.once('error', reject)
        raw.once('data', () => {
          raw.write(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]))
          resolve()
        })
        raw.write(
          'GET /ws/desk HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
            'Cookie: crx_access=fake-token-value\r\n\r\n',
        )
      })
      await new Promise((r) => setTimeout(r, 300))
      raw.destroy()

      expect(uncaught).toEqual([])

      // The server still accepts and greets a normal client afterwards.
      const client = new WebSocket(`ws://127.0.0.1:${port}/ws/desk`, {
        headers: { Cookie: 'crx_access=fake-token-value' },
      })
      const greeting = await new Promise<string>((resolve, reject) => {
        client.once('message', (data) => resolve(data.toString()))
        client.once('error', reject)
      })
      expect(JSON.parse(greeting)).toMatchObject({ type: 'connected' })
      client.terminate()
    } finally {
      process.off('uncaughtException', onUncaught)
      await mod.closeAllDeskConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
