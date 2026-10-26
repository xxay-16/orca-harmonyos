import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NewSshHost, SecretManifest, SshCredentials, StoredHost } from '../ssh/Types';

export class HostVault {
  private encoder: util.TextEncoder = new util.TextEncoder();
  private decoder: util.TextDecoder = new util.TextDecoder('utf-8');
  private indexAlias: string = 'orcaremote.host-index.v1';
  private defaultAlias: string = 'orcaremote.default-host.v1';

  private read(alias: string): string | null {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const records = asset.querySync(query);
      if (records.length === 0) return null;
      const secret = records[0].get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array)) throw new Error('Invalid secure host record');
      return this.decoder.decodeToString(secret);
    } catch (error) {
      if ((error as BusinessError).code === asset.ErrorCode.NOT_FOUND) return null; // SAFETY: Asset Store reports SDK BusinessError values.
      throw new Error('Secure host storage is unavailable');
    }
  }

  private write(alias: string, value: string): void {
    const secret = this.encoder.encodeInto(value);
    if (secret.length > 1024) throw new Error('Host record is too large');
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
    attributes.set(asset.Tag.SECRET, secret);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    asset.addSync(attributes);
  }

  loadHosts(): string {
    const index = this.read(this.indexAlias);
    if (index === null) return '[]';
    const ids = JSON.parse(index) as string[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
    const records: string[] = [];
    for (const id of ids) {
      if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid host index');
      const record = this.read('orcaremote.host.' + id);
      if (record === null) throw new Error('Missing secure host record');
      records.push(record);
    }
    return '[' + records.join(',') + ']';
  }

  saveHosts(value: string): string {
    try {
      if (value.length > 32768) throw new Error('Too many hosts');
      const hosts = JSON.parse(value) as StoredHost[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
      if (hosts.length > 20) throw new Error('Too many hosts');
      const previous = this.read(this.indexAlias);
      const oldIds: string[] = previous === null ? [] : JSON.parse(previous) as string[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
      const ids: string[] = [];
      for (const host of hosts) {
        if (!/^[0-9a-f]{32}$/.test(host.id)) throw new Error('Invalid host id');
        ids.push(host.id);
        this.write('orcaremote.host.' + host.id, JSON.stringify(host));
      }
      this.write(this.indexAlias, JSON.stringify(ids));
      const preferred = this.getDefaultHostId();
      if (ids.indexOf(preferred) < 0) this.write(this.defaultAlias, ids[0] ?? '');
      for (const id of oldIds) {
        if (ids.indexOf(id) < 0 && /^[0-9a-f]{32}$/.test(id)) {
          const query: asset.AssetMap = new Map();
          query.set(asset.Tag.ALIAS, this.encoder.encodeInto('orcaremote.host.' + id));
          asset.removeSync(query);
          this.removeSshCredentials(id);
        }
      }
      return '{"ok":true}';
    } catch (error) {
      hilog.error(0x0000, 'OrcaVault', 'Secure storage write failed, code=%{public}d', (error as BusinessError).code ?? -1); // SAFETY: Asset Store reports SDK BusinessError values.
      return '{"ok":false}';
    }
  }

  getHost(id: string): StoredHost {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid host id');
    const hosts = JSON.parse(this.loadHosts()) as StoredHost[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
    const host = hosts.find((row: StoredHost) => row.id === id);
    if (host === undefined) throw new Error('Host is no longer saved');
    return host;
  }

  getDefaultHostId(): string { return this.read(this.defaultAlias) ?? ''; }

  setDefaultHostId(id: string): void {
    this.getHost(id);
    this.write(this.defaultAlias, id);
  }

  private remove(alias: string): void {
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias));
    try { asset.removeSync(query); }
    catch (error) { if ((error as BusinessError).code !== asset.ErrorCode.NOT_FOUND) throw new Error('Secure record removal failed'); } // SAFETY: Asset Store reports SDK BusinessError values.
  }

  private removeChunks(prefix: string, manifest: SecretManifest): void {
    if (!/^[0-9a-f-]{32,36}$/.test(manifest.generation) || manifest.count < 1 || manifest.count > 128) {
      throw new Error('Invalid SSH secret manifest');
    }
    for (let index = 0; index < manifest.count; index++) this.remove(prefix + '.' + manifest.generation + '.' + index);
  }

  private removeSshCredentials(id: string): void {
    const prefix = 'orcaremote.ssh.' + id;
    const saved = this.read(prefix);
    if (saved === null) return;
    this.removeChunks(prefix, JSON.parse(saved) as SecretManifest); // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
    this.remove(prefix);
  }

  saveSshHost(value: string): string {
    let id = '';
    let chunks: SecretManifest | undefined = undefined;
    let previous: string | null = null;
    try {
      if (value.length > 80000) throw new Error('SSH profile is too large');
      const input = JSON.parse(value) as NewSshHost; // SAFETY: The bundled caller supplies this shape; native validation below checks the fields.
      const profile = input.profile;
      const ssh = profile.ssh;
      id = profile.id;
      if (!/^[0-9a-f]{32}$/.test(id) || ssh === undefined ||
        !/^[a-zA-Z0-9.:[\]_-]{1,253}$/.test(ssh.host) ||
        !Number.isInteger(ssh.port) || ssh.port < 1 || ssh.port > 65535 ||
        !Number.isInteger(ssh.remotePort) || ssh.remotePort < 1 || ssh.remotePort > 65535 ||
        ssh.username.length < 1 || ssh.username.length > 128 ||
        !/^SHA256:[A-Za-z0-9+/]{43}$/.test(ssh.fingerprint) ||
        (ssh.auth !== 'key' && ssh.auth !== 'password')) throw new Error('Invalid SSH profile');
      const hosts = JSON.parse(this.loadHosts()) as StoredHost[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
      const existing = hosts.findIndex((host: StoredHost) => host.id === id);
      if (hosts.length >= 20 && existing < 0) throw new Error('Too many hosts');
      let credentials = input.credentials;
      if (existing >= 0 && hosts[existing].ssh?.auth === ssh.auth &&
        (ssh.auth === 'key' ? credentials.privateKey.length === 0 : credentials.password.length === 0)) {
        credentials = this.getSshCredentials(id);
      }
      if (credentials.privateKey.length > 65536 || credentials.password.length > 4096 || credentials.passphrase.length > 4096 ||
        (ssh.auth === 'key' && !credentials.privateKey.includes('PRIVATE KEY')) ||
        (ssh.auth === 'password' && credentials.password.length === 0)) throw new Error('Invalid SSH credentials');
      // Each Asset Store SECRET is limited to 1024 bytes. Base64 chunks also preserve Unicode passwords.
      const encoded = new util.Base64Helper().encodeToStringSync(this.encoder.encodeInto(JSON.stringify(credentials)));
      chunks = { generation: util.generateRandomUUID(true), count: Math.ceil(encoded.length / 768) };
      if (chunks.count > 128) throw new Error('SSH credentials are too large');
      const prefix = 'orcaremote.ssh.' + id;
      previous = this.read(prefix);
      for (let index = 0; index < chunks.count; index++) {
        this.write(prefix + '.' + chunks.generation + '.' + index, encoded.slice(index * 768, (index + 1) * 768));
      }
      this.write(prefix, JSON.stringify(chunks));
      if (existing < 0) hosts.push(profile);
      else hosts[existing] = profile;
      const result = this.saveHosts(JSON.stringify(hosts));
      if (result !== '{"ok":true}') throw new Error('Could not save SSH host');
      if (previous !== null) {
        try { this.removeChunks(prefix, JSON.parse(previous) as SecretManifest); } catch (_) {} // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
      }
      return result;
    } catch (error) {
      if (chunks !== undefined && /^[0-9a-f]{32}$/.test(id)) {
        try {
          this.removeChunks('orcaremote.ssh.' + id, chunks);
          if (previous === null) this.remove('orcaremote.ssh.' + id);
          else this.write('orcaremote.ssh.' + id, previous);
        } catch (_) {}
      }
      hilog.error(0x0000, 'OrcaVault', 'SSH profile write failed, code=%{public}d', (error as BusinessError).code ?? -1); // SAFETY: Asset Store reports SDK BusinessError values.
      return '{"ok":false}';
    }
  }

  getSshCredentials(id: string): SshCredentials {
    this.getHost(id);
    const prefix = 'orcaremote.ssh.' + id;
    const saved = this.read(prefix);
    if (saved === null) throw new Error('SSH credentials are unavailable; add this host again');
    const manifest = JSON.parse(saved) as SecretManifest; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
    if (!/^[0-9a-f-]{32,36}$/.test(manifest.generation) || manifest.count < 1 || manifest.count > 128) {
      throw new Error('Invalid SSH secret manifest');
    }
    let encoded = '';
    for (let index = 0; index < manifest.count; index++) {
      const chunk = this.read(prefix + '.' + manifest.generation + '.' + index);
      if (chunk === null) throw new Error('Missing SSH secret chunk');
      encoded += chunk;
    }
    return JSON.parse(this.decoder.decodeToString(new util.Base64Helper().decodeSync(encoded))) as SshCredentials; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
  }

  randomBytes(length: number): string {
    if (!Number.isInteger(length) || length < 1 || length > 4096) throw new Error('Invalid random size');
    try {
      const random = cryptoFramework.createRandom().generateRandomSync(length);
      return new util.Base64Helper().encodeToStringSync(random.data);
    } catch (_) {
      throw new Error('Secure random service is unavailable');
    }
  }
}
