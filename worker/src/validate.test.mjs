import {
  validateSubmission, lockTime, hasManageMessages, validateAward, MAX_AWARD, MAX_REASON,
} from './validate.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const games = [
  { id: '1', home: 'AAA', away: 'BBB', kickoff: '2026-09-13T17:00:00Z' },
  { id: '2', home: 'CCC', away: 'DDD', kickoff: '2026-09-13T20:00:00Z' },
  { id: '3', home: 'EEE', away: 'FFF', kickoff: '2026-09-15T00:15:00Z' },
];
const before = Date.parse('2026-09-13T16:00:00Z');
const after = Date.parse('2026-09-13T17:00:01Z');
const good = [
  { game_id: '1', team: 'AAA', confidence: 3 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
];

check('locks at the earliest kickoff', lockTime(games) === Date.parse('2026-09-13T17:00:00Z'));

const ok = validateSubmission({ games, submission: good, now: before });
check('accepts a valid slate', ok.ok === true);
check('returns the picks', ok.ok && ok.picks.length === 3);

const late = validateSubmission({ games, submission: good, now: after });
check('rejects after lock', late.ok === false);
check('says why it rejected', late.ok === false && /lock/i.test(late.error));

const missing = validateSubmission({ games, submission: good.slice(0, 2), now: before });
check('rejects a missing game', missing.ok === false && /every game/i.test(missing.error));

const dupe = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 1 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
]});
check('rejects duplicate confidence', dupe.ok === false && /once/i.test(dupe.error));

const gap = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 1 },
  { game_id: '2', team: 'DDD', confidence: 2 },
  { game_id: '3', team: 'EEE', confidence: 5 },
]});
check('rejects out-of-range confidence', gap.ok === false && /1 to 3/.test(gap.error));

const wrongTeam = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'ZZZ', confidence: 3 },
  { game_id: '2', team: 'DDD', confidence: 1 },
  { game_id: '3', team: 'EEE', confidence: 2 },
]});
check('rejects a team not in the game', wrongTeam.ok === false && /not playing/i.test(wrongTeam.error));

const unknown = validateSubmission({ games, now: before, submission: [
  ...good, { game_id: '99', team: 'AAA', confidence: 4 },
]});
check('rejects an unknown game', unknown.ok === false);

check('rejects a non-array', validateSubmission({ games, submission: null, now: before }).ok === false);

// New tests for critical fixes
const dupGame = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 3 },
  { game_id: '1', team: 'AAA', confidence: 2 },
  { game_id: '1', team: 'AAA', confidence: 1 },
]});
check('rejects duplicate game_id (same game 3 times)', dupGame.ok === false && /only once/i.test(dupGame.error));

const dupGameAndMiss = validateSubmission({ games, now: before, submission: [
  { game_id: '1', team: 'AAA', confidence: 3 },
  { game_id: '1', team: 'AAA', confidence: 2 },
  { game_id: '2', team: 'DDD', confidence: 1 },
]});
check('rejects duplicate game_id with missing game', dupGameAndMiss.ok === false);

// Wrap non-object entry tests to catch throws
const testNonObject = (label, entry) => {
  try {
    const result = validateSubmission({ games, now: before, submission: [entry, good[1], good[2]] });
    check(label, result.ok === false);
  } catch (e) {
    check(label, false);
  }
};

testNonObject('rejects null entry without throwing', null);
testNonObject('rejects string entry without throwing', 'string');
testNonObject('rejects undefined entry without throwing', undefined);

console.log('\n--- who may award points ---');
// Fails closed. A command that edits the standings must never run for someone
// whose permissions could not be read.
const perm = (bit) => ({ permissions: String(1n << BigInt(bit)) });
check('a mod with Manage Messages may', hasManageMessages(perm(13)));
check('an administrator may', hasManageMessages(perm(3)));
check('a plain member may not', !hasManageMessages({ permissions: '0' }));
check('some other permission does not qualify', !hasManageMessages(perm(11)));
check('a missing member may not', !hasManageMessages(undefined));
check('missing permissions may not', !hasManageMessages({}));
check('unparseable permissions may not', !hasManageMessages({ permissions: 'lots' }));
// The exact set the music bots were invited with, as a real-world negative.
check('a music bot permission set does not qualify',
  !hasManageMessages({ permissions: '274914692352' }));

console.log('\n--- awards are checked before they reach the ledger ---');
// The ledger is append-only and public: a bad row is corrected by a second
// visible row, never quietly edited. Cheaper to refuse it here.
check('a normal award passes', validateAward({ points: 10, reason: 'won the bracket' }).ok);
check('a negative award passes, for corrections',
  validateAward({ points: -10, reason: 'double counted' }).ok);
check('zero is refused', !validateAward({ points: 0, reason: 'nothing' }).ok);
check('a fraction is refused', !validateAward({ points: 1.5, reason: 'half' }).ok);
check('a numeric string is refused', !validateAward({ points: '10', reason: 'ten' }).ok);
check('an absurd number is refused', !validateAward({ points: 10000, reason: 'oops' }).ok);
check('the bound holds at the edge', validateAward({ points: MAX_AWARD, reason: 'max' }).ok);
check('one past the bound is refused', !validateAward({ points: MAX_AWARD + 1, reason: 'x' }).ok);
check('an empty reason is refused', !validateAward({ points: 5, reason: '' }).ok);
check('a whitespace-only reason is refused', !validateAward({ points: 5, reason: '   ' }).ok);
check('a missing reason is refused', !validateAward({ points: 5 }).ok);
check('an over-long reason is refused',
  !validateAward({ points: 5, reason: 'x'.repeat(MAX_REASON + 1) }).ok);
check('a reason at the limit passes',
  validateAward({ points: 5, reason: 'x'.repeat(MAX_REASON) }).ok);
check('reason whitespace is tidied',
  validateAward({ points: 5, reason: '  won   the  bracket ' }).reason === 'won the bracket');
check('every refusal explains itself',
  [{ points: 0, reason: 'x' }, { points: 1.5, reason: 'x' }, { points: 5, reason: '' }]
    .every((a) => typeof validateAward(a).error === 'string' && validateAward(a).error.length > 0));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
