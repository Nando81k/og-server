import { webcrypto } from 'node:crypto';
import { isFromDiscord } from './verify.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicKey = toHex(await crypto.subtle.exportKey('raw', pair.publicKey));
const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);

const timestamp = '1725800000';
const body = JSON.stringify({ type: 2, data: { name: 'lfg' } });
const sign = async (key, ts, payload) =>
  toHex(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(ts + payload)));

const good = await sign(pair.privateKey, timestamp, body);

check('accepts a genuine signature', await isFromDiscord({ publicKey, signature: good, timestamp, body }));

// Discord deliberately sends invalid signatures when registering an endpoint.
check('rejects a signature from a different key',
  !(await isFromDiscord({ publicKey, signature: await sign(other.privateKey, timestamp, body), timestamp, body })));
check('rejects a tampered body',
  !(await isFromDiscord({ publicKey, signature: good, timestamp, body: body.replace('lfg', 'evil') })));
check('rejects a replayed timestamp',
  !(await isFromDiscord({ publicKey, signature: good, timestamp: '1725800001', body })));
check('rejects a flipped byte in the signature',
  !(await isFromDiscord({ publicKey, signature: (good[0] === 'a' ? 'b' : 'a') + good.slice(1), timestamp, body })));

// Malformed input must return false, never throw — a throw is a 500, and a 500
// is not the 401 Discord requires.
check('rejects a missing signature', !(await isFromDiscord({ publicKey, signature: undefined, timestamp, body })));
check('rejects non-hex', !(await isFromDiscord({ publicKey, signature: 'zzzz', timestamp, body })));
check('rejects odd-length hex', !(await isFromDiscord({ publicKey, signature: 'abc', timestamp, body })));
check('rejects an empty signature', !(await isFromDiscord({ publicKey, signature: '', timestamp, body })));
check('rejects a bad public key', !(await isFromDiscord({ publicKey: 'nope', signature: good, timestamp, body })));
check('rejects a short public key', !(await isFromDiscord({ publicKey: 'abcd', signature: good, timestamp, body })));
check('rejects a missing timestamp', !(await isFromDiscord({ publicKey, signature: good, timestamp: null, body })));
check('rejects a non-string body', !(await isFromDiscord({ publicKey, signature: good, timestamp, body: { a: 1 } })));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
