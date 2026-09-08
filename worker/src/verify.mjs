/**
 * Discord signs every interaction request with Ed25519. A request that fails
 * this check is not from Discord, and Discord itself sends deliberately bad
 * signatures when you register an endpoint — it refuses the endpoint unless
 * those are rejected with a 401.
 */

const encoder = new TextEncoder();

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Workers and Node both do Ed25519 now, but older Workers only knew it by
// Cloudflare's own name for it.
async function importKey(raw) {
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    );
  }
}

export async function isFromDiscord({ publicKey, signature, timestamp, body }) {
  const keyBytes = hexToBytes(publicKey);
  const sigBytes = hexToBytes(signature);
  if (!keyBytes || !sigBytes || typeof timestamp !== 'string' || typeof body !== 'string') {
    return false;
  }
  let key;
  try {
    key = await importKey(keyBytes);
  } catch {
    return false;
  }
  try {
    return await crypto.subtle.verify(key.algorithm, key, sigBytes, encoder.encode(timestamp + body));
  } catch {
    return false;
  }
}
