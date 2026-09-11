import { weekOneAnnouncement, lockedMessage } from './announce.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- week one announcement ---');
const a = weekOneAnnouncement({ leaderboardChannelId: '123' });
check('pings everyone', a.startsWith('@everyone'));
check('renders the leaderboard as a live channel link', a.includes('<#123>'));
check('falls back to a plain name without an id',
  weekOneAnnouncement({}).includes('#season-leaderboard'));
check('names the command', a.includes('/picks'));
// The gap between this post and week 2's lock is set by the cron hour and the
// schedule, and the copy had it wrong: 63 hours, not 48. A day name cannot drift.
check('claims no specific number of hours', !/\d+\s*hours/.test(a));
check('names the deadline by day instead', a.includes("Thursday night's kickoff"));

console.log('\n--- locked reply ---');
// Week 1 of 2026: first kickoff Wed 8:20 PM ET, last game Monday night.
const games = [
  { kickoff: '2026-09-10T00:20Z' },
  { kickoff: '2026-09-13T17:00Z' },
  { kickoff: '2026-09-15T00:15Z' },
];
const m = lockedMessage({ week: 1, games, leaderboardChannelId: '123' });
check('says which week is locked', m.includes('Week 1 is locked'));
check('reports the lock in Eastern time', m.includes('Wednesday at 8:20 PM ET'));
// toLocaleString glues weekday to time, which read as "closed at Wednesday
// 8:20 PM" — correct data, broken English, and it shipped that way once.
check('reads as English after "closed"', m.includes('Picks closed Wednesday at'));
check('does not say "at Wednesday"', !/at\s+(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/.test(m));
check('names the day the week finishes', m.includes('(Monday)'));
check('points at the next week', m.includes('Week 2 opens'));
check('tells them what to run', m.includes('/picks'));
check('links the leaderboard', m.includes('<#123>'));
// The whole point: the old reply was one flat sentence that read like the
// season was shut.
check('says they have not missed the season', /haven't missed the season/.test(m));
check('is more than one line', m.split('\n').length > 1);

console.log('\n--- locked reply edge cases ---');
const bare = lockedMessage({ week: 3, games: [] });
check('survives a week with no readable kickoffs', bare.includes('Week 3 is locked'));
check('still points at the next week', bare.includes('Week 4 opens'));
check('falls back to a plain channel name', bare.includes('#season-leaderboard'));
check('survives an unparseable kickoff',
  lockedMessage({ week: 2, games: [{ kickoff: 'not-a-date' }] }).includes('Week 3 opens'));
check('survives no arguments at all', typeof lockedMessage() === 'string');
check('a single-game week reports one day',
  lockedMessage({ week: 5, games: [{ kickoff: '2026-09-10T00:20Z' }] }).includes('(Wednesday)'));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
