export interface SshProfile {
  host: string;
  port: number;
  username: string;
  auth: string;
  fingerprint: string;
  remotePort: number;
}

export interface SshCredentials {
  privateKey: string;
  password: string;
  passphrase: string;
}

export interface StoredHost {
  id: string;
  name: string;
  endpoint: string;
  deviceToken: string;
  publicKeyB64: string;
  environmentId?: string;
  pairedDeviceId?: string;
  ssh?: SshProfile;
}

export interface NewSshHost { profile: StoredHost; credentials: SshCredentials; }
export interface SecretManifest { generation: string; count: number; }
