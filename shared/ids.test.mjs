import { readFileSync } from 'node:fs';
import { GUILD_ID, APPLICATION_ID } from './ids.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- the ids are shaped like Discord ids ---');
// Snowflakes are 64-bit, so 17 to 20 digits. A value pasted with a stray
// space, a quote, or the "ID:" prefix people copy along with it still looks
// fine in the file and fails against the API with a flat 404.
for (const [what, id] of [['the server id', GUILD_ID], ['the application id', APPLICATION_ID]]) {
  check(`${what} is a string`, typeof id === 'string');
  check(`${what} is all digits`, /^[0-9]+$/.test(id));
  check(`${what} is snowflake length`, id.length >= 17 && id.length <= 20);
  check(`${what} has no stray whitespace`, id === id.trim());
}
check('they are not the same id', GUILD_ID !== APPLICATION_ID);

console.log('\n--- the server id agrees with the Worker ---');
// wrangler.toml carries its own copy because the Worker reads it at runtime
// from env, not from this file. Two copies of one number is exactly the thing
// that drifts, and the failure is silent: the Worker would post into a server
// the scripts never touch.
const wrangler = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const inWrangler = wrangler.match(/^GUILD_ID\s*=\s*"([0-9]+)"/m)?.[1];
check('wrangler.toml declares a GUILD_ID', Boolean(inWrangler));
check('it is the same server the scripts target', inWrangler === GUILD_ID);

console.log('\n--- the scripts use them ---');
// The point of the file. A script that still prompts for an id it could have
// read is one more chance to paste the wrong one at 1am.
const scripts = [
  'register-commands.mjs', 'seed-channels.mjs', 'setup-server.mjs', 'upload-emoji.mjs',
];
for (const name of scripts) {
  const src = readFileSync(new URL(`../scripts/discord/${name}`, import.meta.url), 'utf8');
  check(`${name} imports the shared ids`, /from '\.\.\/\.\.\/shared\/ids\.mjs'/.test(src));
  check(`${name} no longer asks for an id`, !/askVisible/.test(src));
  check(`${name} still lets the environment override`, /process\.env\.GUILD_ID/.test(src));
  // The token is the one thing that must never be defaulted, stored or echoed.
  check(`${name} still prompts for the token rather than storing it`,
    /askHidden/.test(src) && !/BOT_TOKEN\s*=\s*['"][A-Za-z0-9]/.test(src));
}

console.log('\n--- no secret crept in ---');
const idsSrc = readFileSync(new URL('./ids.mjs', import.meta.url), 'utf8');
// A bot token is three dot-separated base64 chunks and is never 18 digits, so
// anything token-shaped landing in this file is a mistake worth failing on.
check('ids.mjs holds no token-shaped string',
  !/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/.test(idsSrc));
check('ids.mjs exports exactly the two ids',
  (idsSrc.match(/^export const /gm) ?? []).length === 2);

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
