// A throwaway EASYPASS_HOME (settings.json + key.bin + vault.ezp) in the real file format, so the installed
// EasyPass.Host.exe and EasyPass.exe open it exactly like a user's vault. prepareHome is Windows only (key.bin is DPAPI).
// Format (src/EasyPass.Core/Vault.cs): "EZP1" | iterations int32 LE | salt 16 | nonce 12 | tag 16 | AES-256-GCM(JSON),
// AAD = first 24 bytes, key = PBKDF2-SHA256(master password, salt, iterations, 32).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ITERATIONS = 600_000;
const HEADER = 24, NONCE = 12, TAG = 16;

const entry = (site, u) => ({
  id: crypto.randomUUID().replaceAll('-', ''), site, firstName: u.first, lastName: u.last, extra1: '', extra2: '',
  username: u.username, password: u.password, updatedAt: new Date().toISOString(),
});

function encrypt(key, salt, entries) {
  const header = Buffer.alloc(HEADER);
  header.write('EZP1', 0, 'ascii');
  header.writeInt32LE(ITERATIONS, 4);
  salt.copy(header, 8);
  const nonce = crypto.randomBytes(NONCE);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG }).setAAD(header);
  const cipher = Buffer.concat([c.update(JSON.stringify({ entries })), c.final()]);
  return Buffer.concat([header, nonce, c.getAuthTag(), cipher]);
}

function decrypt(key, data) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(HEADER, HEADER + NONCE), { authTagLength: TAG })
    .setAAD(data.subarray(0, HEADER))
    .setAuthTag(data.subarray(HEADER + NONCE, HEADER + NONCE + TAG));
  return JSON.parse(Buffer.concat([d.update(data.subarray(HEADER + NONCE + TAG)), d.final()]).toString('utf8')).entries;
}

// key.bin = DPAPI(CurrentUser)(salt + key): what the app writes when unlocked, so the host can open the vault.
function saveKeyCache(file, salt, key) {
  const b64 = Buffer.concat([salt, key]).toString('base64');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Security; [IO.File]::WriteAllBytes('${file}', [Security.Cryptography.ProtectedData]::Protect(` +
    `[Convert]::FromBase64String('${b64}'), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))`]);
}

// A vault file holding each site's users. sites: [{ host, users: [{ first, last, username, password }] }].
// Returns readEntries() for assertions, plus salt and key.
export function writeVault(vaultPath, sites, masterPassword) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(masterPassword, salt, ITERATIONS, 32, 'sha256');
  fs.writeFileSync(vaultPath, encrypt(key, salt, sites.flatMap((s) => s.users.map((u) => entry(s.host, u)))));
  return { salt, key, readEntries: () => decrypt(key, fs.readFileSync(vaultPath)) };
}

// A whole EASYPASS_HOME: that vault, settings pointing at it and the key cache, as if the app had just unlocked it.
export function prepareHome(home, sites, masterPassword, lang = 'tr') {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const vaultPath = path.join(home, 'vault.ezp');
  const { salt, key, readEntries } = writeVault(vaultPath, sites, masterPassword);
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ vaultPath, lang }));
  saveKeyCache(path.join(home, 'key.bin'), salt, key);
  return { vaultPath, readEntries };
}
