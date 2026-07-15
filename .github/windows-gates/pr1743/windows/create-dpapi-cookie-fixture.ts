import { Database } from 'bun:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isolatedHome = path.resolve(process.argv[2] || '');
if (!isolatedHome) throw new Error('usage: bun create-dpapi-cookie-fixture.ts <isolated-home>');

const sentinel = 'GSTACK_PR1743_WINDOWS_DPAPI_SENTINEL_d4f531ce6a';
const userData = path.join(isolatedHome, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
const networkDir = path.join(userData, 'Default', 'Network');
const dbPath = path.join(networkDir, 'Cookies');
const keyPath = path.join(isolatedHome, 'fixture-aes-key.b64');
const digestPath = path.join(isolatedHome, 'expected-cookie.sha256');
fs.mkdirSync(networkDir, { recursive: true });

const key = crypto.randomBytes(32);
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const ciphertext = Buffer.concat([cipher.update(sentinel, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const encryptedValue = Buffer.concat([Buffer.from('v10'), nonce, ciphertext, tag]);

fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
fs.writeFileSync(digestPath, crypto.createHash('sha256').update(sentinel).digest('hex'), { mode: 0o600 });

try { fs.rmSync(dbPath, { force: true }); } catch {}
const db = new Database(dbPath, { create: true });
try {
  db.exec(`
    CREATE TABLE cookies (
      host_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      has_expires INTEGER NOT NULL,
      samesite INTEGER NOT NULL
    );
  `);
  db.query(`
    INSERT INTO cookies
      (host_key, name, value, encrypted_value, path, expires_utc,
       is_secure, is_httponly, has_expires, samesite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('127.0.0.1', 'pr1743_cookie', '', encryptedValue, '/', 0, 0, 0, 0, 1);
} finally {
  db.close();
}

console.log(JSON.stringify({
  fixture: 'synthetic-chrome-dpapi-v10',
  dbPath,
  localStatePath: path.join(userData, 'Local State'),
  keyPath,
  digestPath,
  encryptedBytes: encryptedValue.length,
  plaintextLogged: false,
}));
