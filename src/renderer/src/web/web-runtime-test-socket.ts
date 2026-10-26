import { vi, type Mock } from 'vitest'

export const fakeSockets: FakeWebSocket[] = []

export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close: Mock<() => void> = vi.fn()
  send: Mock<(value: unknown) => void> = vi.fn()

  constructor(readonly _url: string) {
    fakeSockets.push(this)
  }
}

export function installWebRuntimeTestSocket(): void {
  fakeSockets.length = 0
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    // Why: the connected-state liveness heartbeat arms a window.setInterval, so
    // the stub must provide interval timers once a client reaches 'connected'.
    setInterval,
    clearInterval,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
  })
  vi.stubGlobal('WebSocket', FakeWebSocket)
}
