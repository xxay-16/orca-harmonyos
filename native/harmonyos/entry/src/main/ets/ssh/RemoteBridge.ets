import { openTunnel, closeTunnel, probeHost, TunnelOptions, ProbeOptions } from 'liborcassh.so';
import { HostVault } from '../security/HostVault';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { resourceManager } from '@kit.LocalizationKit';
import { util } from '@kit.ArkTS';

function sshFailure(error: Error): string {
  const message = error.message ?? '';
  const codes: string[] = ['SSH_HOSTKEY_MISMATCH', 'SSH_HOSTKEY_REQUIRED', 'SSH_AUTH_FAILED'];
  const code = codes.find((value: string) => message.includes(value)) ?? 'SSH_CONNECTION_FAILED';
  return JSON.stringify({ error: code });
}

export class RemoteBridge {
  private vault: HostVault = new HostVault();
  private ports: Set<number> = new Set();
  private disposed: boolean = false;
  private generation: number = 0;
  private resources?: resourceManager.ResourceManager;

  activate(): void { this.disposed = false; this.generation++; }
  setResourceManager(resources: resourceManager.ResourceManager): void { this.resources = resources; }

  readBundledResource(path: string): string {
    if (!path.startsWith('console/') || path.includes('..') || path.includes('\\') || path.includes('%') ||
      !/\.(json|txt|svg|wasm|js|css|woff2?)$/.test(path) || this.resources === undefined) {
      throw new Error('Invalid bundled resource');
    }
    const bytes = this.resources.getRawFileContentSync(path);
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Bundled resource is too large');
    return new util.Base64Helper().encodeToStringSync(bytes);
  }

  loadHosts(): string { return this.vault.loadHosts(); }
  saveHosts(value: string): string { return this.vault.saveHosts(value); }
  saveSshHost(value: string): string { return this.vault.saveSshHost(value); }
  randomBytes(length: number): string { return this.vault.randomBytes(length); }
  getDefaultHostId(): string { return this.vault.getDefaultHostId(); }
  setDefaultHostId(id: string): void { this.vault.setDefaultHostId(id); }
  setColorScheme(mode: string): void {
    if (mode === 'dark' || mode === 'light') AppStorage.setOrCreate('orcaremote.dark-mode', mode === 'dark');
  }

  async probeSsh(value: string): Promise<string> {
    try { return JSON.stringify({ fingerprint: await this.probeConnection(value) }); }
    catch (error) { return sshFailure(error as Error); } // SAFETY: The native SSH promise rejects with an Error.
  }

  private async probeConnection(value: string): Promise<string> {
    if (value.length > 1024) throw new Error('Invalid SSH address');
    const options = JSON.parse(value) as ProbeOptions; // SAFETY: The bundled caller supplies this shape; native validation below checks the fields.
    if (!/^[a-zA-Z0-9.:[\]_-]{1,253}$/.test(options.host) ||
      !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Invalid SSH address');
    return await probeHost(options);
  }

  async openSsh(id: string): Promise<string> {
    try { return await this.openConnection(id); }
    catch (error) { return sshFailure(error as Error); } // SAFETY: The native SSH promise rejects with an Error.
  }

  private async openConnection(id: string): Promise<string> {
    if (this.disposed) throw new Error('Client page is closed');
    const generation = this.generation;
    const profile = this.vault.getHost(id);
    const ssh = profile.ssh;
    if (ssh === undefined) throw new Error('Host is not an SSH connection');
    const credentials = this.vault.getSshCredentials(id);
    const options: TunnelOptions = {
      host: ssh.host, port: ssh.port, username: ssh.username, auth: ssh.auth,
      fingerprint: ssh.fingerprint, remotePort: ssh.remotePort,
      privateKey: credentials.privateKey, password: credentials.password, passphrase: credentials.passphrase
    };
    try {
      const localPort = await openTunnel(options);
      hilog.info(0x0000, 'OrcaSsh', 'Native SSH local port=%{public}d, type=%{public}s', localPort, typeof localPort);
      if (this.disposed || generation !== this.generation) {
        await closeTunnel(localPort); throw new Error('Client page is closed');
      }
      this.ports.add(localPort);
      return JSON.stringify({ localPort: localPort });
    } finally {
      credentials.privateKey = ''; credentials.password = ''; credentials.passphrase = '';
      options.privateKey = ''; options.password = ''; options.passphrase = '';
    }
  }

  async closeSsh(localPort: number): Promise<void> {
    if (!this.ports.has(localPort)) return;
    this.ports.delete(localPort);
    await closeTunnel(localPort);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.ports.forEach((port: number) => { this.closeSsh(port).catch(() => {}); });
  }
}
