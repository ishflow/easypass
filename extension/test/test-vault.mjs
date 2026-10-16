// A throwaway EASYPASS_HOME (settings.json + key.bin + vault.ezp) in the real file format, so the installed
// EasyPass.Host.exe and EasyPass.exe open it exactly like a user's vault. A key cache (vault with a password) needs Windows DPAPI.
// Format (src/EasyPass.Core/Vault.cs): "EZP1" | iterations int32 LE | salt 16 | nonce 12 | tag 16 | AES-256-GCM(JSON),
// AAD = first 24 bytes, key = PBKDF2-SHA256(master password, salt, iterations, 32).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// An empty password = a vault without a master password: one PBKDF2 round, like Vault.cs.
const iterationsFor = (password) => (password === '' ? 1 : 600_000);
const HEADER = 24, NONCE = 12, TAG = 16;

const entry = (site, u) => ({
  id: crypto.randomUUID().replaceAll('-', ''), site, firstName: u.first, lastName: u.last, extra1: '', extra2: '',
  username: u.username, password: u.password, updatedAt: new Date().toISOString(),
});

function encrypt(key, salt, iterations, entries) {
  const header = Buffer.alloc(HEADER);
  header.write('EZP1', 0, 'ascii');
  header.writeInt32LE(iterations, 4);
  salt.copy(header, 8);
  const nonce = crypto.randomBytes(NONCE);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG }).setAAD(header);
  const cipher = Buffer.concat([c.update(JSON.stringify({ entries })), c.final()]);
  return Buffer.concat([header, nonce, c.getAuthTag(), cipher]);
}

// The entries of a vault file; the key is derived from the salt and rounds in its header.
export function readVault(vaultPath, password) {
  const data = fs.readFileSync(vaultPath);
  const key = crypto.pbkdf2Sync(password, data.subarray(8, HEADER), data.readInt32LE(4), 32, 'sha256');
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
// Empty masterPassword (the default) = no master password. Returns readEntries() for assertions, plus salt and key.
export function writeVault(vaultPath, sites, masterPassword = '') {
  const salt = crypto.randomBytes(16);
  const iterations = iterationsFor(masterPassword);
  const key = crypto.pbkdf2Sync(masterPassword, salt, iterations, 32, 'sha256');
  fs.writeFileSync(vaultPath, encrypt(key, salt, iterations, sites.flatMap((s) => s.users.map((u) => entry(s.host, u)))));
  return { salt, key, readEntries: () => readVault(vaultPath, masterPassword) };
}

// A whole EASYPASS_HOME: that vault and settings pointing at it. A vault with a master password also gets the key
// cache, as if the app had just unlocked it; one without needs none (app and host open it from the file alone).
export function prepareHome(home, sites, masterPassword = '', lang = 'tr') {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const vaultPath = path.join(home, 'vault.ezp');
  const { salt, key, readEntries } = writeVault(vaultPath, sites, masterPassword);
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ vaultPath, lang }));
  if (masterPassword) saveKeyCache(path.join(home, 'key.bin'), salt, key);
  return { vaultPath, readEntries };
}
