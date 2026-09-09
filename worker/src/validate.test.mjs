import { validateSubmission, lockTime } from './validate.mjs';

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

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
