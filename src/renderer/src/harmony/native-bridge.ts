import { z } from 'zod'
import { createBrowserUuid } from '../lib/browser-uuid'
import type { PairedRuntimeConnection } from '../../../shared/paired-runtime-connection'
import {
  createStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment,
  installWebRuntimeEnvironmentPersistence,
  type StoredWebRuntimeEnvironment
} from '../web/web-runtime-environment'
import {
  installWebRuntimeEndpointProvider,
  WebRuntimeEndpointError
} from '../web/web-runtime-endpoint-provider'

export type HarmonyNativeBridge = {
  loadHosts(): string
  saveHosts(value: string): string
  getDefaultHostId(): string
  setDefaultHostId(id: string): void
  randomBytes(length: number): string
  openSsh(id: string): Promise<string>
  closeSsh(localPort: number): Promise<void>
  setColorScheme?(mode: string): void
  readBundledResource(path: string): string
}

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Window requires declaration merging for the native bridge.
  interface Window {
    OrcaNative?: HarmonyNativeBridge
  }
}

const profileSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1),
  endpoint: z.string().url(),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1),
  environmentId: z.string().optional(),
  pairedDeviceId: z.string().optional(),
  ssh: z
    .object({
      host: z.string(),
      port: z.number().int(),
      username: z.string(),
      auth: z.enum(['key', 'password']),
      fingerprint: z.string(),
      remotePort: z.number().int()
    })
    .optional()
})
const openResultSchema = z.union([
  z.object({ localPort: z.number().int().min(1).max(65535) }),
  z.object({ error: z.string() })
])

function bridge(): HarmonyNativeBridge {
  const native = window.OrcaNative
  if (!native) {
    throw new Error('当前页面需要在鸿蒙应用中打开。')
  }
  return native
}

function nativeProfiles() {
  return z.array(profileSchema).max(20).parse(JSON.parse(bridge().loadHosts()))
}

function persistNativeProfiles(hosts: z.infer<typeof profileSchema>[]): void {
  z.object({ ok: z.literal(true) }).parse(JSON.parse(bridge().saveHosts(JSON.stringify(hosts))))
}

let lastSavedEnvironment: string | null = null

function saveNativeEnvironment(environment: StoredWebRuntimeEnvironment): void {
  const endpoint = environment.endpoints[0]
  if (!endpoint) {
    throw new Error('连接缺少 Runtime 地址。')
  }
  const signature = JSON.stringify({
    id: environment.id,
    name: environment.name,
    endpoint: endpoint.endpoint,
    deviceToken: endpoint.deviceToken,
    publicKeyB64: endpoint.publicKeyB64,
    pairedDeviceId: environment.pairedDeviceId
  })
  if (lastSavedEnvironment === signature) {
    return
  }
  const hosts = nativeProfiles()
  const existing = hosts.find(
    (host) =>
      host.environmentId === environment.id ||
      (host.publicKeyB64 === endpoint.publicKeyB64 &&
        new URL(host.endpoint).href === new URL(endpoint.endpoint).href)
  )
  const host = {
    ...existing,
    id: existing?.id ?? createBrowserUuid().replaceAll('-', ''),
    name: environment.name,
    endpoint: endpoint.endpoint,
    deviceToken: endpoint.deviceToken,
    publicKeyB64: endpoint.publicKeyB64,
    environmentId: environment.id,
    ...(environment.pairedDeviceId ? { pairedDeviceId: environment.pairedDeviceId } : {})
  }
  persistNativeProfiles([...hosts.filter((row) => row.id !== host.id), host])
  bridge().setDefaultHostId(host.id)
  lastSavedEnvironment = signature
}

async function resolveNativeEndpoint(connection: PairedRuntimeConnection) {
  const profile = nativeProfiles().find(
    (host) =>
      host.publicKeyB64 === connection.hostPublicKeyB64 &&
      new URL(host.endpoint).href === new URL(connection.endpoint).href
  )
  if (!profile) {
    const hostname = new URL(connection.endpoint).hostname
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      throw new WebRuntimeEndpointError('回环地址需要设备上已保存的 SSH 配置。', true)
    }
    return { endpoint: connection.endpoint, dispose() {} }
  }
  if (!profile.ssh) {
    return { endpoint: connection.endpoint, dispose() {} }
  }
  const result = openResultSchema.parse(JSON.parse(await bridge().openSsh(profile.id)))
  if ('error' in result) {
    const fatal = ['SSH_HOSTKEY_MISMATCH', 'SSH_HOSTKEY_REQUIRED', 'SSH_AUTH_FAILED'].includes(
      result.error
    )
    const message =
      result.error === 'SSH_HOSTKEY_MISMATCH'
        ? 'SSH 主机指纹已变化，请核实服务器身份。'
        : result.error === 'SSH_AUTH_FAILED'
          ? 'SSH 认证失败，请检查登录凭据。'
          : 'SSH 连接失败，请检查网络和主机配置。'
    throw new WebRuntimeEndpointError(message, fatal)
  }
  const endpoint = new URL(connection.endpoint)
  if (endpoint.protocol !== 'ws:') {
    await bridge().closeSsh(result.localPort)
    throw new WebRuntimeEndpointError('SSH 模式需要主机本地的 ws:// Runtime 配对地址。', true)
  }
  endpoint.hostname = '127.0.0.1'
  endpoint.port = String(result.localPort)
  let closed = false
  return {
    endpoint: endpoint.href,
    dispose() {
      if (closed) {
        return
      }
      closed = true
      void bridge()
        .closeSsh(result.localPort)
        .catch(() => {})
    }
  }
}

export function installHarmonyRuntime(): void {
  lastSavedEnvironment = null
  const native = bridge()
  const hosts = nativeProfiles()
  const preferred = native.getDefaultHostId()
  const host = hosts.find((row) => row.id === preferred) ?? hosts[0]
  if (!host) {
    throw new Error('设备尚未配置 SSH 主机，请先导入连接配置。')
  }
  installWebRuntimeEnvironmentPersistence({
    save: saveNativeEnvironment,
    clear: (environment) => {
      lastSavedEnvironment = null
      if (environment) {
        persistNativeProfiles(
          nativeProfiles().filter((profile) => profile.environmentId !== environment.id)
        )
      }
    }
  })
  const environment = createStoredWebRuntimeEnvironment({
    name: host.name,
    offer: {
      v: 2,
      endpoint: host.endpoint,
      deviceToken: host.deviceToken,
      publicKeyB64: host.publicKeyB64,
      scope: 'runtime',
      ...(host.pairedDeviceId ? { pairedDeviceId: host.pairedDeviceId } : {})
    },
    ...(host.ssh ? { connectionDependency: 'ssh-tunnel' } : {})
  })
  const id = host.environmentId ?? `harmony-${host.id}`
  saveStoredWebRuntimeEnvironment({
    ...environment,
    id,
    sessionOnly: true,
    preferredEndpointId: `ws-${id}`,
    endpoints: environment.endpoints.map((endpoint) => ({ ...endpoint, id: `ws-${id}` }))
  })
  installWebRuntimeEndpointProvider(resolveNativeEndpoint)
}
