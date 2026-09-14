/**
 * The handbook claims to be complete. This is what makes that true.
 *
 * A guide that quietly falls out of sync with the server is worse than no
 * guide: people trust it, act on it, and find a channel that is not there or
 * miss one that is. Adding a channel or a command should fail here until the
 * handbook mentions it.
 */

import { readFileSync } from 'node:fs';
import { planChannels, VOICE, FORUM } from '../scripts/discord/channel-names.mjs';
import { COMMANDS, BRACKET_MOD_ONLY } from '../shared/commands.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const html = readFileSync(new URL('./handbook.html', import.meta.url), 'utf8');
const channels = planChannels();

console.log('--- every channel is in the handbook ---');
const missing = channels.filter((c) => {
  // Voice rooms are written by name; text and forum channels with a leading #.
  const needle = c.type === VOICE ? `>${c.name}<` : `#${c.name}<`;
  return !html.includes(needle);
}).map((c) => c.name);
check(`all ${channels.length} channels appear${missing.length ? ` (missing: ${missing})` : ''}`,
  missing.length === 0);

// The page says the number out loud, so the number has to be right.
const claimed = { 43: 'Forty-three' }[channels.length];
check('the handbook knows how many channels there are',
  Boolean(claimed) && html.includes(claimed));

console.log('\n--- every command is in the handbook ---');
const missingCmds = [];
for (const cmd of COMMANDS) {
  const subs = (cmd.options ?? []).filter((o) => o.type === 1);
  if (subs.length === 0) {
    if (!html.includes(`/${cmd.name}`)) missingCmds.push(`/${cmd.name}`);
    continue;
  }
  for (const s of subs) {
    if (!html.includes(`/${cmd.name} ${s.name}`)) missingCmds.push(`/${cmd.name} ${s.name}`);
  }
}
check(`every registered command is documented${missingCmds.length ? ` (${missingCmds})` : ''}`,
  missingCmds.length === 0);

// Telling someone a command is open when a mod check will refuse it is the
// kind of small lie that makes people stop trusting the whole page.
console.log('\n--- mod-only commands are marked as such ---');
/**
 * The one `<div class="cmd">` a command sits in.
 *
 * Bounded at the next row rather than by a character count: the rows are
 * adjacent, so a fixed window reads the neighbouring command's MOD badge and
 * reports every open command as gated.
 */
function commandRow(needle) {
  const at = html.indexOf(needle);
  if (at === -1) return null;
  const next = html.indexOf('<div class="cmd">', at);
  return html.slice(at, next === -1 ? at + 800 : next);
}
for (const name of BRACKET_MOD_ONLY) {
  const row = commandRow(`/bracket ${name}`);
  check(`/bracket ${name} is marked MOD`, Boolean(row) && row.includes('class="mod"'));
}
check('/award is marked MOD', (() => {
  const row = commandRow('/award &lt;user&gt;');
  return Boolean(row) && row.includes('class="mod"');
})());
const openSubs = ['join', 'leave', 'view', 'report'];
for (const name of openSubs) {
  const row = commandRow(`/bracket ${name}`);
  check(`/bracket ${name} is not marked MOD`, Boolean(row) && !row.includes('class="mod"'));
}

console.log('\n--- the points table matches the code ---');
// These numbers are also in tournament.mjs. Two copies of a number is the
// thing that drifts, and here the drift is a public promise about points.
const { PLACEMENT_POINTS } = await import('../worker/src/tournament.mjs');
for (const band of PLACEMENT_POINTS) {
  check(`${band.points} points appears in the handbook`,
    new RegExp(`>${band.points}<`).test(html));
}

console.log('\n--- it renders as a page ---');
check('it has a title', /<title>[^<]+<\/title>/.test(html));
// The Artifact wrapper supplies doctype, head and body.
check('no stray document scaffolding', !/<html|<body|<!doctype/i.test(html));
check('every section the nav points at exists',
  [...html.matchAll(/href="#([a-z-]+)"/g)].every((m) => html.includes(`id="${m[1]}"`)));
check('no leftover template placeholder', !/\{\{|\bTODO\b|\bTBD\b|lorem/i.test(html));

// A colour defined only inside a media query renders unstyled for viewers on
// the default "system" theme setting, which stamps no attribute at all.
const rootBlock = html.slice(html.indexOf(':root {'), html.indexOf('@media'));
const used = new Set([...html.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]));
const declared = new Set([...rootBlock.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
const undeclared = [...used].filter((v) => !declared.has(v));
check(`every colour token is declared on bare :root${undeclared.length ? ` (${undeclared})` : ''}`,
  undeclared.length === 0);
check('both themes are defined',
  html.includes('prefers-color-scheme: dark') && html.includes('[data-theme="dark"]'));
check('the body paints its own background', /body\s*\{[^}]*background:\s*var\(--ground\)/.test(html));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
