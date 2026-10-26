import type { HarmonyNativeBridge } from './native-bridge'

function bootstrap(native: HarmonyNativeBridge | undefined): void {
  Reflect.set(window, '__ORCA_WEB_CLIENT__', true)
  if (!native) {
    return
  }
  const secureRandomBridge = native
  const fetchResource = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input)
    const url = new URL(address, document.baseURI)
    if (url.protocol !== 'resource:' || url.hostname !== 'rawfile') {
      return fetchResource(input, init)
    }
    if (init?.signal?.aborted) {
      throw init.signal.reason
    }
    const path = decodeURIComponent(url.pathname).replace(/^\//, '')
    try {
      const raw = atob(secureRandomBridge.readBundledResource(path))
      const bytes = Uint8Array.from(raw, (value) => value.charCodeAt(0))
      const type = path.endsWith('.json')
        ? 'application/json'
        : path.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream'
      return new Response(bytes, { status: 200, headers: { 'Content-Type': type } })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
  const cryptoObject: Partial<Crypto> = window.crypto ?? {}
  function randomValues<T extends ArrayBufferView | null>(view: T): T {
    if (!view || !ArrayBuffer.isView(view)) {
      throw new Error('Expected an integer typed array')
    }
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    if (bytes.length > 65536) {
      throw new Error('Random request is too large')
    }
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const raw = atob(secureRandomBridge.randomBytes(Math.min(4096, bytes.length - offset)))
      for (let index = 0; index < raw.length; index++) {
        bytes[offset + index] = raw.charCodeAt(index)
      }
    }
    return view
  }
  if (typeof cryptoObject.getRandomValues !== 'function') {
    Object.defineProperty(cryptoObject, 'getRandomValues', { value: randomValues })
  }
  if (!window.crypto) {
    Object.defineProperty(window, 'crypto', { value: cryptoObject })
  }
}

bootstrap(window.OrcaNative)
