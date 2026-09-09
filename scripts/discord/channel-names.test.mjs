import {
  SERVER_PLAN,
  CATEGORY_EMOJI,
  CHANNEL_EMOJI,
  categoryDisplayName,
  channelDisplayName,
  planChannels,
  TEXT,
  VOICE,
} from './channel-names.mjs';
import { normalizeChannelName } from '../bot/lib.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const channels = planChannels();
const categories = SERVER_PLAN.map((s) => s.category);

console.log('--- display names ---');
check('a text channel gets the bar separator', channelDisplayName('2k', TEXT) === '🏀┃2k');
check('a voice channel gets a plain space', channelDisplayName('2K Voice', VOICE) === '🔊 2K Voice');
check('a category gets a plain space', categoryDisplayName('GAMES') === '🎮 GAMES');
check('an unmapped channel is left alone', channelDisplayName('not-a-channel', TEXT) === 'not-a-channel');
check('an unmapped category is left alone', categoryDisplayName('NOPE') === 'NOPE');
check('type defaults to text', channelDisplayName('2k') === '🏀┃2k');

console.log('\n--- every channel is decorated ---');
const undecorated = channels.filter((c) => !CHANNEL_EMOJI[c.name]).map((c) => c.name);
check(`all ${channels.length} channels have an emoji` + (undecorated.length ? ` (missing: ${undecorated})` : ''),
  undecorated.length === 0);
const undecoratedCats = categories.filter((c) => !CATEGORY_EMOJI[c]);
check(`all ${categories.length} categories have an emoji` + (undecoratedCats.length ? ` (missing: ${undecoratedCats})` : ''),
  undecoratedCats.length === 0);

console.log('\n--- no dead entries ---');
const planned = new Set(channels.map((c) => c.name));
const orphanChannels = Object.keys(CHANNEL_EMOJI).filter((n) => !planned.has(n));
check(`no emoji for a channel that does not exist` + (orphanChannels.length ? ` (${orphanChannels})` : ''),
  orphanChannels.length === 0);
const plannedCats = new Set(categories);
const orphanCats = Object.keys(CATEGORY_EMOJI).filter((n) => !plannedCats.has(n));
check(`no emoji for a category that does not exist` + (orphanCats.length ? ` (${orphanCats})` : ''),
  orphanCats.length === 0);

console.log('\n--- names Discord will accept unchanged ---');
// Discord silently rewrites a text channel name containing spaces or capitals.
// If that happened, the name we wrote and the name stored would differ and the
// script would try to rename on every single run.
const rewritten = channels
  .filter((c) => c.type !== VOICE)
  .map((c) => channelDisplayName(c.name, c.type))
  .filter((n) => /\s/.test(n) || n !== n.toLowerCase());
check(`no text channel name has a space or capital` + (rewritten.length ? ` (${rewritten})` : ''),
  rewritten.length === 0);
const tooLong = channels
  .map((c) => channelDisplayName(c.name, c.type))
  .filter((n) => [...n].length > 100);
check('every name is within Discord\'s 100 character limit', tooLong.length === 0);

console.log('\n--- renames stay reversible ---');
// The setup script finds an existing channel by normalized name. If decorating
// a name changed how it normalizes, a re-run would not recognise it and would
// build a duplicate instead of renaming.
const drifted = channels.filter(
  (c) => normalizeChannelName(channelDisplayName(c.name, c.type)) !== normalizeChannelName(c.name)
);
check('decorating a name does not change how it normalizes' + (drifted.length ? ` (${drifted.map((d) => d.name)})` : ''),
  drifted.length === 0);

console.log('\n--- categories stay distinguishable ---');
// Two categories sharing an emoji defeats the point of having one.
const catEmoji = categories.map((c) => CATEGORY_EMOJI[c]);
const dupeCats = catEmoji.filter((e, i) => catEmoji.indexOf(e) !== i);
check('no two categories share an emoji' + (dupeCats.length ? ` (${[...new Set(dupeCats)]})` : ''),
  dupeCats.length === 0);

console.log('\n--- no collisions ---');
const seen = new Map();
const collisions = [];
for (const c of channels) {
  const key = `${c.category}:${normalizeChannelName(c.name)}`;
  if (seen.has(key)) collisions.push(key);
  seen.set(key, c.name);
}
check('no two channels in a category normalize alike', collisions.length === 0);

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
