import { webcrypto } from 'node:crypto';
import worker, { handleLfg, runPromotions } from './index.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

const ROLES = [
  { id: '100', name: '2K' }, { id: '101', name: 'CoD' },
  { id: '200', name: 'New Member' }, { id: '201', name: 'Member' },
];
const CHANNELS = [{ id: '900', name: '2K Voice' }, { id: '901', name: 'CoD Voice' }];
const env = { GUILD_ID: '1546707076460445787', DISCORD_TOKEN: 'x', MEMBER_AFTER_DAYS: 7 };

function fakeApi(members = []) {
  const calls = [];
  return {
    calls,
    roles: async () => ROLES,
    channels: async () => CHANNELS,
    members: async () => members,
    addRole: async (g, u, r) => calls.push(['add', u, r]),
    removeRole: async (g, u, r) => calls.push(['remove', u, r]),
  };
}

console.log('--- /lfg ---');
{
  const res = await handleLfg(
    { data: { options: [{ name: 'game', value: '2k' }, { name: 'slots', value: 4 }] },
      member: { user: { id: '555' } } }, env, fakeApi());
  check('pings the game role by id', res.content.includes('<@&100>'));
  check('links the standing voice room', res.content.includes('<#900>'));
  check('credits whoever ran it', res.content.includes('<@555>'));
  check('states the slot count', res.content.includes('4 slots'));
  check('only the game role may be pinged', res.allowed_mentions.roles.join() === '100'
    && res.allowed_mentions.parse.length === 0);
}
{
  const res = await handleLfg({ data: { options: [{ name: 'game', value: 'halo' }] },
    member: { user: { id: '5' } } }, env, fakeApi());
  check('unknown game is refused, not crashed', res.content === 'Unknown game.' && res.flags === 64);
}
{
  const res = await handleLfg({ data: { options: [{ name: 'game', value: 'cod' }] },
    member: { user: { id: '5' } } }, env, fakeApi());
  check('slots default to 5 when omitted', res.content.includes('5 slots'));
}

console.log('\n--- promotions ---');
{
  const day = 86400000, now = Date.parse('2026-09-08T00:00:00Z');
  const iso = (d) => new Date(now - d * day).toISOString();
  const api = fakeApi([
    { user: { id: 'old' }, roles: ['200'], joined_at: iso(9) },
    { user: { id: 'fresh' }, roles: ['200'], joined_at: iso(2) },
    { user: { id: 'exactly7' }, roles: ['200'], joined_at: iso(7) },
    { user: { id: 'already' }, roles: ['201'], joined_at: iso(30) },
    { user: { id: 'nodate' }, roles: ['200'], joined_at: null },
  ]);
  const out = await runPromotions(env, api, now);
  check('promotes the two who are due', out.promoted === 2);
  check('leaves the ones who are not', out.skipped === 2);
  check('adds Member then removes New Member', api.calls.filter((c) => c[0] === 'add').length === 2
    && api.calls.filter((c) => c[0] === 'remove').length === 2);
  check('never touches an existing Member', !api.calls.some((c) => c[1] === 'already'));
  check('never promotes a member with no join date', !api.calls.some((c) => c[1] === 'nodate'));
}

console.log('\n--- the endpoint ---');
{
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = toHex(await crypto.subtle.exportKey('raw', pair.publicKey));
  const e = { ...env, DISCORD_PUBLIC_KEY: publicKey };
  const sign = async (ts, b) =>
    toHex(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(ts + b)));

  const body = JSON.stringify({ type: 1 });
  const ts = '1725800000';
  const req = (b, sig, t = ts) => new Request('https://x/', {
    method: 'POST', body: b,
    headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': t },
  });

  const good = await worker.fetch(req(body, await sign(ts, body)), e);
  check('answers Discord\'s PING with a PONG', good.status === 200 && (await good.json()).type === 1);

  const bad = await worker.fetch(req(body, 'ff'.repeat(64)), e);
  check('rejects a bad signature with 401', bad.status === 401);

  const none = await worker.fetch(new Request('https://x/', { method: 'POST', body }), e);
  check('rejects an unsigned request with 401', none.status === 401);

  const get = await worker.fetch(new Request('https://x/', { method: 'GET' }), e);
  check('rejects a GET', get.status === 405);

  const junk = 'not json';
  const j = await worker.fetch(req(junk, await sign(ts, junk)), e);
  check('signed junk is a 400, not a crash', j.status === 400);
}

console.log('\n--- /picks method allowlist ---');
{
  // No token needed: the method check happens before token verification, so
  // an unsupported method must come back as a clean 405, never a 500 from
  // dereferencing `submitted.picks` while `submitted` is still null.
  const res = await worker.fetch(new Request('https://x/picks?t=whatever', { method: 'PUT' }), env);
  check('a non-GET, non-POST request to /picks is a 405, not a crash', res.status === 405);
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
