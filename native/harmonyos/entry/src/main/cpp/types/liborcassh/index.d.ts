export type TunnelOptions = {
  host: string
  port: number
  username: string
  auth: string
  privateKey: string
  password: string
  passphrase: string
  fingerprint: string
  remotePort: number
}
export type ProbeOptions = { host: string; port: number }
export const openTunnel: (options: TunnelOptions) => Promise<number>
export const probeHost: (options: ProbeOptions) => Promise<string>
export const closeTunnel: (localPort: number) => Promise<void>
export const isTunnelAlive: (localPort: number) => boolean
