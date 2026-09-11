import {
  GAME_ROLES, GAME_VOICE, voiceRoomFor,
  isDueForPromotion, clampSlots,
  normalizeChannelName, isChannelNamed,
} from './lib.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- games ---');
// Whether every /lfg choice has a role and a room lives in commands.test.mjs,
// which reads the real command definition. A hand-written list of games here
// would be the weaker of two sources of truth and the one that goes stale
// without saying so — it did, which is why that file exists.
check('voiceRoomFor resolves a known game', voiceRoomFor('2k') === '2K Voice');
check('voiceRoomFor throws on an unknown game',
  (() => { try { voiceRoomFor('halo'); return false; } catch { return true; } })());
// An internal invariant of this module, independent of what /lfg offers:
// a game in one map and not the other pings people into a room that does not
// exist, or fills a room nobody was told about.
check('the role map and the room map cover the same games',
  Object.keys(GAME_ROLES).sort().join() === Object.keys(GAME_VOICE).sort().join());

console.log('\n--- promotion ---');
const now = 1_000_000_000;
const day = 24 * 60 * 60 * 1000;
check('6 days is too soon', !isDueForPromotion({ joinedAt: now - 6 * day, now, afterDays: 7 }));
check('7 days exactly is due', isDueForPromotion({ joinedAt: now - 7 * day, now, afterDays: 7 }));
check('8 days is due', isDueForPromotion({ joinedAt: now - 8 * day, now, afterDays: 7 }));
check('missing join date never promotes', !isDueForPromotion({ joinedAt: null, now, afterDays: 7 }));

console.log('\n--- slots ---');
check('default holds', clampSlots(5) === 5);
check('1 is raised to 2', clampSlots(1) === 2);
check('0 does not mean unlimited', clampSlots(0) === 2);
check('over 99 is clamped', clampSlots(500) === 99);
check('garbage falls back to 5', clampSlots('abc') === 5);
check('rounds a decimal', clampSlots(4.6) === 5);

console.log('\n--- channel name matching ---');
check('strips a leading emoji and bar', normalizeChannelName('🏀┃2k') === '2k');
check('strips an emoji and space', normalizeChannelName('🔊 2K Voice') === '2k-voice');
check('leaves a plain slug alone', normalizeChannelName('2k') === '2k');
check('lowercases and hyphenates', normalizeChannelName('2K Voice') === '2k-voice');
check('collapses runs of separators', normalizeChannelName('🔊┃┃ 2K   Voice') === '2k-voice');
check('trims trailing decoration', normalizeChannelName('2K Voice 🎮') === '2k-voice');
check('survives an empty name', normalizeChannelName('') === '');
check('survives a missing name', normalizeChannelName(undefined) === '');
check('decorated room matches the plain one',
  isChannelNamed({ name: '🔊 2K Voice' }, '2K Voice'));
check('a different room still does not match',
  !isChannelNamed({ name: '🔊 CoD Voice' }, '2K Voice'));
check('near-miss names do not collide',
  !isChannelNamed({ name: '2K Voice Chat' }, '2K Voice'));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
