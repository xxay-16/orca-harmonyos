import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { pairedRuntimeConnectionFromOffer } from '../../../shared/paired-runtime-connection'
import { WebRuntimeClient } from './web-runtime-client'
import { WebRuntimeConnectionTransport } from './web-runtime-connection-transport'
import { fakeSockets, installWebRuntimeTestSocket } from './web-runtime-test-socket'
import {
  installWebRuntimeEndpointProvider,
  WebRuntimeEndpointError,
  type WebRuntimeEndpointLease
} from './web-runtime-endpoint-provider'

describe('native runtime endpoint leases', () => {
  beforeEach(installWebRuntimeTestSocket)
  afterEach(() => vi.unstubAllGlobals())
  it('opens an asynchronously prepared endpoint without changing the paired host identity', async () => {
    const dispose = vi.fn()
    const restore = installWebRuntimeEndpointProvider(async () => ({
      endpoint: 'ws://127.0.0.1:45678',
      dispose
    }))
    const connection = pairedRuntimeConnectionFromOffer({
      endpoint: 'ws://host.test:6768',
      deviceToken: 'token',
      publicKeyB64: Buffer.alloc(32).toString('base64')
    })
    const client = new WebRuntimeClient(connection)
    try {
      expect(fakeSockets).toHaveLength(0)
      await vi.waitFor(() => expect(fakeSockets).toHaveLength(1))
      expect(new URL(fakeSockets[0]._url).port).toBe('45678')
      expect(connection.endpoint).toBe('ws://host.test:6768')
      client.close()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      client.close()
      restore()
    }
  })

  it('releases a late native endpoint when the client closes during SSH authentication', async () => {
    let finish: (lease: WebRuntimeEndpointLease) => void = () => {
      throw new Error('Endpoint was not requested')
    }
    const pending = new Promise<WebRuntimeEndpointLease>((resolve) => {
      finish = resolve
    })
    const restore = installWebRuntimeEndpointProvider(() => pending)
    const dispose = vi.fn()
    const client = new WebRuntimeClient(
      pairedRuntimeConnectionFromOffer({
        endpoint: 'ws://host.test:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32).toString('base64')
      })
    )
    try {
      client.close()
      finish({ endpoint: 'ws://127.0.0.1:45678', dispose })
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
      expect(fakeSockets).toHaveLength(0)
    } finally {
      client.close()
      restore()
    }
  })

  it('stops reconnecting when a native endpoint rejects the pinned host identity', async () => {
    vi.useFakeTimers()
    const open = vi.fn(async () => {
      throw new WebRuntimeEndpointError('Host fingerprint changed', true)
    })
    const restore = installWebRuntimeEndpointProvider(open)
    const client = new WebRuntimeClient(
      pairedRuntimeConnectionFromOffer({
        endpoint: 'ws://host.test:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32).toString('base64')
      })
    )
    try {
      const rejected = expect(client.call('status.get')).rejects.toThrow('Host fingerprint changed')
      await vi.advanceTimersByTimeAsync(5000)
      await rejected
      expect(open).toHaveBeenCalledOnce()
      expect(fakeSockets).toHaveLength(0)
    } finally {
      client.close()
      restore()
      vi.useRealTimers()
    }
  })

  it('keeps connection waiters pending while a temporary native failure retries', async () => {
    vi.useFakeTimers()
    installWebRuntimeTestSocket()
    const open = vi
      .fn<() => Promise<WebRuntimeEndpointLease>>()
      .mockRejectedValueOnce(new WebRuntimeEndpointError('SSH handshake interrupted', false))
      .mockResolvedValue({ endpoint: 'ws://127.0.0.1:45678', dispose: vi.fn() })
    const restore = installWebRuntimeEndpointProvider(open)
    const transport = new WebRuntimeConnectionTransport(
      pairedRuntimeConnectionFromOffer({
        endpoint: 'ws://host.test:6768',
        deviceToken: 'token',
        publicKeyB64: Buffer.alloc(32).toString('base64')
      }),
      { now: () => Date.now(), isDocumentVisible: () => true }
    )
    const settled = vi.fn()
    const waiting = transport.waitForConnected(10_000).then(
      () => settled('connected'),
      () => settled('failed')
    )
    try {
      await vi.advanceTimersByTimeAsync(2000)
      expect(open).toHaveBeenCalledTimes(2)
      expect(fakeSockets).toHaveLength(1)
      expect(settled).not.toHaveBeenCalled()
      transport.setState('connected')
      await waiting
      expect(settled).toHaveBeenCalledWith('connected')
    } finally {
      transport.close()
      restore()
      vi.useRealTimers()
    }
  })
})
