import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import BuildProfile from 'BuildProfile';
import { HostVault } from '../security/HostVault';
import { NewSshHost, StoredHost } from './Types';

// Debug provisioning uses the application's private files directory, never a HAP resource.
// HDC may write this file only for a debuggable, installed application.
export function importDeviceDefaults(context: common.UIAbilityContext): void {
  if (!BuildProfile.DEBUG) return;
  const path = context.getApplicationContext().filesDir + '/orca-default-ssh.json';
  try {
    if (!fileIo.accessSync(path)) return;
    if (fileIo.statSync(path).size > 80000) throw new Error('Default profile is too large');
    const input = JSON.parse(fileIo.readTextSync(path)) as NewSshHost; // SAFETY: The bundled caller supplies this shape; native validation below checks the fields.
    const vault = new HostVault();
    const hosts = JSON.parse(vault.loadHosts()) as StoredHost[]; // SAFETY: The app-owned secure writer produces this record shape; identifiers and bounds are checked on read.
    const matching = hosts.find((host: StoredHost) =>
      host.publicKeyB64 === input.profile.publicKeyB64 &&
      host.endpoint.replace(/\/$/, '') === input.profile.endpoint.replace(/\/$/, ''));
    if (matching !== undefined) {
      input.profile.id = matching.id;
      input.profile.environmentId = matching.environmentId;
      input.profile.pairedDeviceId = matching.pairedDeviceId;
    }
    const result = vault.saveSshHost(JSON.stringify(input));
    if (result !== '{"ok":true}') throw new Error('Could not save default SSH profile');
    vault.setDefaultHostId(input.profile.id);
    fileIo.unlinkSync(path);
    hilog.info(0x0000, 'OrcaDefaults', 'Default SSH profile imported into secure storage');
  } catch (_) {
    hilog.error(0x0000, 'OrcaDefaults', 'Default SSH profile import failed');
  }
}
