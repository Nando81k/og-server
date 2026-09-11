import { BOT_SCOPES } from './bot-scopes.mjs';
import { planChannels } from './channel-names.mjs';
import { VIEW_CHANNEL, SEND_MESSAGES } from './permissions.mjs';
import { normalizeChannelName } from '../../shared/lib.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const planned = new Set(planChannels().map((c) => normalizeChannelName(c.name)));

console.log('--- every home channel exists ---');
// The one that matters. confineBots denies a scoped bot in every channel and
// allows it only in its home. If the home slug stops matching a real channel
// — renamed, retired, a typo — the script warns and leaves the bot's
// permissions alone, so a bot that looks confined in this file is quietly
// roaming the whole server. Nothing at run time would say so.
for (const scope of BOT_SCOPES) {
  for (const slug of scope.only) {
    check(`${scope.roles.join('/')} -> #${slug} is a real channel`,
      planned.has(normalizeChannelName(slug)));
  }
}

console.log('\n--- scopes are well formed ---');
for (const scope of BOT_SCOPES) {
  const who = scope.roles.join('/');
  check(`${who} names at least one role`, scope.roles.length > 0);
  check(`${who} names at least one home channel`, scope.only.length > 0);
  // An empty bits mask would write an overwrite that denies nothing, leaving
  // the bot loose while every log line claims it was confined.
  check(`${who} denies something`, typeof scope.bits === 'bigint' && scope.bits > 0n);
  check(`${who} always denies View Channel`, (scope.bits & VIEW_CHANNEL) === VIEW_CHANNEL);
}

console.log('\n--- no bot is scoped twice ---');
// Two scopes naming the same role would fight: the second pass would deny the
// bot in the first scope's home channel.
const seen = [];
for (const scope of BOT_SCOPES) seen.push(...scope.roles);
const dupes = seen.filter((r, i) => seen.indexOf(r) !== i);
check(`no role appears in two scopes${dupes.length ? ` (${[...new Set(dupes)]})` : ''}`,
  dupes.length === 0);

console.log('\n--- the card bots are still confined ---');
const cards = BOT_SCOPES.find((s) => s.roles.includes('Karuta'));
check('Karuta is scoped', Boolean(cards));
check('Mudae is scoped alongside it', cards?.roles.includes('Mudae'));
check('their home is #gacha', cards?.only.join() === 'gacha');
// Prefix-command bots read message content in every channel they can see, so
// taking Send Messages away is not enough on its own.
check('they lose both View Channel and Send Messages',
  cards?.bits === (VIEW_CHANNEL | SEND_MESSAGES));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
