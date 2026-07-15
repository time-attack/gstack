import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const gstackRoot = path.resolve(process.argv[2] || '');
const isolatedHome = path.resolve(process.argv[3] || '');
if (!gstackRoot || !isolatedHome) {
  throw new Error('usage: bun dpapi-core-probe.ts <gstack-root> <isolated-home>');
}

process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

const require = createRequire(import.meta.url);
const hasNativeBun = typeof globalThis.Bun !== 'undefined';
if (!hasNativeBun) {
  require(path.join(gstackRoot, 'browse', 'src', 'bun-polyfill.cjs'));
}
const source = path.join(gstackRoot, 'browse', 'src', 'cookie-import-browser.ts');
const moduleUrl = `${pathToFileURL(source).href}?probe=${Date.now()}`;
const { importCookies } = await import(moduleUrl);

const result = await importCookies('chrome', ['127.0.0.1'], 'Default');
const expectedDigest = fs.readFileSync(path.join(isolatedHome, 'expected-cookie.sha256'), 'utf8').trim();
const cookie = result.cookies.find((entry: { name: string }) => entry.name === 'pr1743_cookie');
const actualDigest = cookie
  ? crypto.createHash('sha256').update(cookie.value).digest('hex')
  : null;
const matched = actualDigest === expectedDigest;

console.log(JSON.stringify({
  productionModule: 'browse/src/cookie-import-browser.ts',
  polyfill: hasNativeBun ? 'native-bun-global' : 'browse/src/bun-polyfill.cjs',
  runtime: hasNativeBun ? 'bun-native-runtime' : 'node-runtime-with-bun-polyfill',
  count: result.count,
  failed: result.failed,
  cookiePresent: Boolean(cookie),
  digestMatched: matched,
  plaintextLogged: false,
}));
process.exit(result.count === 1 && result.failed === 0 && matched ? 0 : 1);
