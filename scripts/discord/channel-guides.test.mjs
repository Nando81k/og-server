import {
  GUIDES, FORUM_GUIDELINES, FORUM_TAGS, ALREADY_PINNED, referencedSlugs, renderGuide,
} from './channel-guides.mjs';
import { planChannels, VOICE, FORUM } from './channel-names.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const channels = planChannels();
const bySlug = new Map(channels.map((c) => [c.name, c]));
const slugs = new Set(channels.map((c) => c.name));

console.log('--- every guide targets a real channel ---');
const unknown = Object.keys(GUIDES).filter((s) => !slugs.has(s));
check('no guide for a channel that does not exist' + (unknown.length ? ` (${unknown})` : ''),
  unknown.length === 0);

console.log('\n--- guides go on text channels only ---');
const wrongType = Object.keys(GUIDES).filter((s) => {
  const t = bySlug.get(s)?.type;
  return t === VOICE || t === FORUM;
});
check('no guide aimed at a voice or forum channel' + (wrongType.length ? ` (${wrongType})` : ''),
  wrongType.length === 0);

console.log('\n--- coverage ---');
// Every plain text channel should end up with a pinned explainer: either one
// written by hand already, or one here.
const covered = new Set([...Object.keys(GUIDES), ...ALREADY_PINNED]);
const textChannels = channels.filter((c) => c.type !== VOICE && c.type !== FORUM).map((c) => c.name);
const missing = textChannels.filter((s) => !covered.has(s));
check(`all ${textChannels.length} text channels are covered` + (missing.length ? ` (missing: ${missing})` : ''),
  missing.length === 0);
const staleHandwritten = ALREADY_PINNED.filter((s) => !slugs.has(s));
check('no hand-pinned entry for a channel that does not exist' + (staleHandwritten.length ? ` (${staleHandwritten})` : ''),
  staleHandwritten.length === 0);
const doubled = ALREADY_PINNED.filter((s) => s in GUIDES);
check('nothing is both hand-pinned and generated' + (doubled.length ? ` (${doubled})` : ''),
  doubled.length === 0);

console.log('\n--- forum guidelines ---');
const forums = channels.filter((c) => c.type === FORUM).map((c) => c.name);
const uncoveredForums = forums.filter((s) => !(s in FORUM_GUIDELINES));
check(`all ${forums.length} forums have guidelines` + (uncoveredForums.length ? ` (missing: ${uncoveredForums})` : ''),
  uncoveredForums.length === 0);
const notAForum = Object.keys(FORUM_GUIDELINES).filter((s) => bySlug.get(s)?.type !== FORUM);
check('no guidelines aimed at a non-forum channel' + (notAForum.length ? ` (${notAForum})` : ''),
  notAForum.length === 0);
const bothWays = Object.keys(FORUM_GUIDELINES).filter((s) => s in GUIDES);
check('nothing has both a pinned guide and guidelines', bothWays.length === 0);
// A forum topic allows 4096 characters, four times a text channel's limit.
const longGuidelines = Object.entries(FORUM_GUIDELINES).filter(([, t]) => [...t].length > 4000);
check('guidelines stay under the 4096 character forum limit' +
  (longGuidelines.length ? ` (${longGuidelines.map((g) => g[0])})` : ''), longGuidelines.length === 0);
check('guidelines are meaningfully longer than the one-line topic they replace',
  Object.values(FORUM_GUIDELINES).every((t) => t.length > 200));

console.log('\n--- forum tags ---');
const untagged = forums.filter((s) => !(s in FORUM_TAGS));
check(`all ${forums.length} forums have tags` + (untagged.length ? ` (missing: ${untagged})` : ''),
  untagged.length === 0);
const tagsNotAForum = Object.keys(FORUM_TAGS).filter((s) => bySlug.get(s)?.type !== FORUM);
check('no tags aimed at a non-forum channel' + (tagsNotAForum.length ? ` (${tagsNotAForum})` : ''),
  tagsNotAForum.length === 0);
for (const [slug, tags] of Object.entries(FORUM_TAGS)) {
  // Discord: at most 20 tags per forum, each name at most 20 characters.
  check(`#${slug} is within Discord's 20 tag limit`, tags.length <= 20);
  const longNames = tags.filter((t) => [...t.name].length > 20).map((t) => t.name);
  check(`#${slug} tag names fit in 20 characters` + (longNames.length ? ` (${longNames})` : ''),
    longNames.length === 0);
  const names = tags.map((t) => t.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  check(`#${slug} has no duplicate tag name` + (dupes.length ? ` (${dupes})` : ''), dupes.length === 0);
  const noEmoji = tags.filter((t) => !t.emoji).map((t) => t.name);
  check(`#${slug} tags all carry an emoji` + (noEmoji.length ? ` (${noEmoji})` : ''), noEmoji.length === 0);
  const empty = tags.filter((t) => !t.name?.trim());
  check(`#${slug} has no blank tag name`, empty.length === 0);
}

console.log('\n--- cross-references resolve ---');
const badRefs = [];
for (const [slug, text] of Object.entries({ ...GUIDES, ...FORUM_GUIDELINES })) {
  for (const ref of referencedSlugs(text)) {
    if (!slugs.has(ref)) badRefs.push(`${slug} -> #${ref}`);
  }
}
check('every {#slug} points at a real channel' + (badRefs.length ? ` (${badRefs})` : ''),
  badRefs.length === 0);
const selfRefs = Object.entries({ ...GUIDES, ...FORUM_GUIDELINES })
  .filter(([slug, t]) => referencedSlugs(t).includes(slug));
check('no guide links to its own channel' + (selfRefs.length ? ` (${selfRefs.map((s) => s[0])})` : ''),
  selfRefs.length === 0);

console.log('\n--- Discord will accept them ---');
const tooLong = Object.entries(GUIDES).filter(([, t]) => [...t].length > 1900);
check('every guide leaves room under the 2000 character limit' +
  (tooLong.length ? ` (${tooLong.map((t) => t[0])})` : ''), tooLong.length === 0);
const empty = Object.entries(GUIDES).filter(([, t]) => !t.trim());
check('no guide is empty', empty.length === 0);
const leftoverBraces = Object.entries(GUIDES).filter(([, t]) =>
  /\{[^#]/.test(t) || /\{#[^}]*$/.test(t));
check('no malformed placeholder', leftoverBraces.length === 0);

console.log('\n--- rendering ---');
const ids = new Map([['general-chat', '111'], ['lfg', '222']]);
check('a known slug becomes a mention',
  renderGuide('see {#general-chat} now', ids) === 'see <#111> now');
check('two slugs both render',
  renderGuide('{#lfg} and {#general-chat}', ids) === '<#222> and <#111>');
check('an unknown slug degrades to plain text, not braces',
  renderGuide('go to {#nowhere}', ids) === 'go to #nowhere');
check('a plain object works as well as a Map',
  renderGuide('{#lfg}', { lfg: '333' }) === '<#333>');
check('text with no placeholder is untouched',
  renderGuide('nothing here', ids) === 'nothing here');
check('no rendered guide keeps a placeholder',
  Object.values(GUIDES).every((t) => !/\{#/.test(renderGuide(t, new Map(channels.map((c, i) => [c.name, String(i)]))))));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
