import { webcrypto } from 'node:crypto';
import { signPickToken, verifyPickToken } from './token.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const secret = 'test-secret';
const now = 1_757_000_000_000;
const claims = { userId: '555', season: 2026, week: 1, exp: now + 3600_000 };
const token = await signPickToken(claims, secret);

const ok = await verifyPickToken(token, secret, now);
check('round-trips the user', ok && ok.userId === '555');
check('round-trips season and week', ok && ok.season === 2026 && ok.week === 1);
check('the token carries no readable secret', !token.includes(secret));

check('rejects the wrong secret', (await verifyPickToken(token, 'other', now)) === null);
check('rejects an expired token', (await verifyPickToken(token, secret, claims.exp + 1)) === null);
check('accepts right up to expiry', (await verifyPickToken(token, secret, claims.exp)) !== null);
check('rejects a tampered payload',
  (await verifyPickToken('x' + token.slice(1), secret, now)) === null);
check('rejects a tampered signature',
  (await verifyPickToken(token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A'), secret, now)) === null);
check('rejects a token with no signature', (await verifyPickToken('onlypayload', secret, now)) === null);
check('rejects empty', (await verifyPickToken('', secret, now)) === null);
check('rejects undefined', (await verifyPickToken(undefined, secret, now)) === null);
check('rejects junk', (await verifyPickToken('!!!.???', secret, now)) === null);

// Forging a payload without the secret must not work.
const forged = btoa(JSON.stringify({ userId: '999', season: 2026, week: 1, exp: now + 1000 }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + token.split('.')[1];
check('rejects a swapped payload with a valid-looking signature',
  (await verifyPickToken(forged, secret, now)) === null);

// Test cases for invalid exp values — construct bad payloads and sign them properly
const enc = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const keyForSigning = await crypto.subtle.importKey(
  'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
);

async function makeTokenWithBadExp(payloadJson) {
  const payload = b64url(enc.encode(payloadJson));
  const sig = await crypto.subtle.sign('HMAC', keyForSigning, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

const infToken = await makeTokenWithBadExp('{"userId":"555","season":2026,"week":1,"exp":1e400}');
check('rejects exp of Infinity', (await verifyPickToken(infToken, secret, now)) === null);

const stringExpToken = await makeTokenWithBadExp('{"userId":"555","season":2026,"week":1,"exp":"9999999999999"}');
check('rejects exp as a string', (await verifyPickToken(stringExpToken, secret, now)) === null);

const missingExpToken = await makeTokenWithBadExp('{"userId":"555","season":2026,"week":1}');
check('rejects exp absent', (await verifyPickToken(missingExpToken, secret, now)) === null);

const nullExpToken = await makeTokenWithBadExp('{"userId":"555","season":2026,"week":1,"exp":null}');
check('rejects exp as null', (await verifyPickToken(nullExpToken, secret, now)) === null);

// A third segment must reject the whole token, not be silently dropped —
// otherwise an attacker can append arbitrary content (e.g. </script><script>)
// after a valid token and have it treated as valid by callers that trust the
// verified value still equals the raw string they were handed.
check('rejects a token with a third segment appended',
  (await verifyPickToken(`${token}.anything`, secret, now)) === null);
check('rejects a token with four segments',
  (await verifyPickToken(`${token}.a.b`, secret, now)) === null);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
