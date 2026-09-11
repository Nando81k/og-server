import { createApi } from './rest.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200, json: async () => ({ id: 'm1' }) };
};

const api = createApi('token');

console.log('--- postMessage pings nothing unless asked ---');
{
  sent.length = 0;
  await api.postMessage('123', 'hello <@everyone> <@&1> <@2>');
  const body = sent[0].body;
  // The leaderboard is full of user mentions every week. Rendering them is the
  // point; notifying five people that a table exists is not.
  check('defaults to an empty parse list',
    Array.isArray(body.allowed_mentions.parse) && body.allowed_mentions.parse.length === 0);
  check('sends the content unchanged', body.content === 'hello <@everyone> <@&1> <@2>');
  check('posts to the right channel', sent[0].url.endsWith('/channels/123/messages'));
  check('authorizes as a bot', sent[0].init.headers.Authorization === 'Bot token');
}

console.log('\n--- an explicit ping is honoured ---');
{
  sent.length = 0;
  await api.postMessage('123', 'oi', { parse: ['everyone'] });
  check('passes the caller\'s allowed_mentions through',
    sent[0].body.allowed_mentions.parse.join() === 'everyone');
}
{
  sent.length = 0;
  await api.postMessage('123', 'oi', { parse: [], users: ['7'] });
  check('a narrower ping is passed through intact',
    sent[0].body.allowed_mentions.users.join() === '7'
      && sent[0].body.allowed_mentions.parse.length === 0);
}

console.log('\n--- errors surface rather than pass silently ---');
{
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Missing Permissions' });
  let threw = null;
  try { await api.postMessage('123', 'x'); } catch (err) { threw = err; }
  check('a non-ok response throws', threw !== null);
  check('the error names the status', /403/.test(threw?.message ?? ''));
}

globalThis.fetch = realFetch;
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
