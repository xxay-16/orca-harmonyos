import type { PairedRuntimeConnection } from '../../../shared/paired-runtime-connection'

export type WebRuntimeEndpointLease = { endpoint: string; dispose(): void }
type EndpointProvider = (connection: PairedRuntimeConnection) => Promise<WebRuntimeEndpointLease>

export class WebRuntimeEndpointError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean
  ) {
    super(message)
    this.name = 'WebRuntimeEndpointError'
  }
}

let provider: EndpointProvider | null = null

export function installWebRuntimeEndpointProvider(next: EndpointProvider): () => void {
  const previous = provider
  provider = next
  return () => {
    if (provider === next) {
      provider = previous
    }
  }
}

export function prepareWebRuntimeEndpoint(
  connection: PairedRuntimeConnection
): Promise<WebRuntimeEndpointLease> | null {
  return provider?.(connection) ?? null
}

export class WebRuntimeEndpointOwner {
  private lease: WebRuntimeEndpointLease | null = null
  private generation = 0
  private opening = false
  private closed = false

  open(
    connection: PairedRuntimeConnection,
    callbacks: {
      ready(endpoint: string): void
      waiting(): void
      failed(error: Error, fatal: boolean): void
    }
  ): void {
    if (this.closed || this.opening) {
      return
    }
    const pending = prepareWebRuntimeEndpoint(connection)
    if (!pending) {
      callbacks.ready(connection.endpoint)
      return
    }
    const generation = ++this.generation
    this.opening = true
    callbacks.waiting()
    void pending
      .then((lease) => {
        if (this.closed || generation !== this.generation) {
          lease.dispose()
          return
        }
        this.opening = false
        this.lease = lease
        callbacks.ready(lease.endpoint)
      })
      .catch((reason: unknown) => {
        if (this.closed || generation !== this.generation) {
          return
        }
        this.opening = false
        callbacks.failed(
          reason instanceof Error ? reason : new Error(String(reason)),
          reason instanceof WebRuntimeEndpointError && reason.fatal
        )
      })
  }

  release(): void {
    this.lease?.dispose()
    this.lease = null
  }

  close(): void {
    this.closed = true
    this.generation++
    this.opening = false
    this.release()
  }
}
