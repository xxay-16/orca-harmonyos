import { afterEach, expect, it, vi } from 'vitest'
import { installHarmonyRuntime } from './native-bridge'
import {
  readStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment
} from '../web/web-runtime-environment'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(() => vi.unstubAllGlobals())

it('writes native credentials only when durable connection fields change', () => {
  const id = 'a'.repeat(32)
  const profiles = [
    {
      id,
      name: 'Test host',
      endpoint: 'ws://127.0.0.1:6768',
      deviceToken: 'test-secret-token',
      publicKeyB64: Buffer.alloc(32).toString('base64'),
      ssh: {
        host: 'test.example',
        port: 22,
        username: 'test',
        auth: 'key',
        fingerprint: `SHA256:${'A'.repeat(43)}`,
        remotePort: 6768
      }
    }
  ]
  const saveHosts = vi.fn(() => '{"ok":true}')
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    OrcaNative: {
      loadHosts: () => JSON.stringify(profiles),
      saveHosts,
      getDefaultHostId: () => id,
      setDefaultHostId: vi.fn()
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    }
  })
  installHarmonyRuntime()
  const environment = readStoredWebRuntimeEnvironment()
  if (!environment) {
    throw new Error('Missing native environment')
  }
  saveStoredWebRuntimeEnvironment({ ...environment, runtimeId: 'runtime-new', updatedAt: 10 })
  expect(saveHosts).toHaveBeenCalledTimes(1)
  saveStoredWebRuntimeEnvironment({ ...environment, name: 'Renamed host' })
  expect(saveHosts).toHaveBeenCalledTimes(2)
  expect(storage.get('orca.web.runtimeEnvironment.v1')).toBeUndefined()
})
