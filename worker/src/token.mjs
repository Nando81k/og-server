const enc = new TextEncoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function key(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function signPickToken(claims, secret) {
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyPickToken(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    // Exactly two segments — a token with a stray extra "." (e.g. an
    // attacker-appended `</script><script>...` payload) must be rejected
    // outright, not silently truncated to its first two segments.
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    if (!payload || !sig) return null;
    const valid = await crypto.subtle.verify(
      'HMAC', await key(secret), unb64url(sig), enc.encode(payload)
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    if (!Number.isFinite(claims.exp) || now > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
