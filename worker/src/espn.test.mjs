import { readFileSync } from 'node:fs';
import { parseScoreboard, fetchWeek, fetchCurrentWeek } from './espn.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };
const load = (n) => JSON.parse(readFileSync(new URL(`../test/fixtures/${n}`, import.meta.url)));

const done = parseScoreboard(load('week-complete.json'));
check('reads the season', done.season === 2025);
check('reads the week', done.week === 1);
check('reads every game', done.games.length === 16);
check('all games completed', done.games.every((g) => g.completed));
check('every completed game has a winner or is voided',
  done.games.every((g) => g.winner !== null || g.voided));
check('winner is a team in the game',
  done.games.every((g) => !g.winner || g.winner === g.home || g.winner === g.away));
check('kickoff is ISO', done.games.every((g) => !Number.isNaN(Date.parse(g.kickoff))));
check('ids are strings', done.games.every((g) => typeof g.id === 'string' && g.id.length > 0));

const pre = parseScoreboard(load('week-pre.json'));
check('unplayed games are not completed', pre.games.every((g) => !g.completed));
check('unplayed games have no winner', pre.games.every((g) => g.winner === null));
check('unplayed games are not voided', pre.games.every((g) => !g.voided));

// A tie: completed, but nobody flagged as winner.
const tie = parseScoreboard({
  season: { year: 2025 }, week: { number: 9 },
  events: [{ id: '1', date: '2025-11-02T18:00Z', competitions: [{
    status: { type: { completed: true, state: 'post' } },
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'NYG' }, winner: false },
      { homeAway: 'away', team: { abbreviation: 'PHI' }, winner: false },
    ] }] }],
});
check('a tie is voided', tie.games[0].voided === true);
check('a tie has no winner', tie.games[0].winner === null);

// Validation tests
const checkThrows = (label, fn, expectedMsg) => {
  try {
    fn();
    check(label, false);
  } catch (e) {
    check(label, e.message.includes(expectedMsg));
  }
};

checkThrows('event missing competitions array throws with event id',
  () => parseScoreboard({
    season: { year: 2025 }, week: { number: 1 },
    events: [{ id: '401772510', date: '2025-09-04T20:20Z', competitions: [] }],
  }),
  'Malformed event 401772510');

checkThrows('event missing home competitor throws with event id',
  () => parseScoreboard({
    season: { year: 2025 }, week: { number: 1 },
    events: [{
      id: '401772511',
      date: '2025-09-04T20:20Z',
      competitions: [{
        status: { type: { completed: false } },
        competitors: [
          { homeAway: 'away', team: { abbreviation: 'KC' }, winner: false },
        ]
      }],
    }],
  }),
  'Malformed event 401772511');

checkThrows('payload with no season throws',
  () => parseScoreboard({
    week: { number: 1 },
    events: [],
  }),
  'missing season');

checkThrows('payload with no week throws',
  () => parseScoreboard({
    season: { year: 2025 },
    events: [],
  }),
  'missing week');

const empty = parseScoreboard({
  season: { year: 2026 }, week: { number: 1 }, events: []
});
check('empty events returns valid object',
  empty.season === 2026 && empty.week === 1 && empty.games.length === 0);

// fetchWeek: this is the query-string construction that finding 1 (an empty
// slate silently voiding a whole week) hinges on — it's what tells ESPN
// which season/week to return, so a malformed query here is indistinguishable
// from an empty week at the call site.
{
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => load('week-complete.json') };
  };
  await fetchWeek({ season: 2026, week: 4, fetchImpl });
  const parsed = new URL(requestedUrl);
  check('fetchWeek requests the scoreboard endpoint',
    parsed.origin + parsed.pathname === 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  check('fetchWeek requests the right season as dates', parsed.searchParams.get('dates') === '2026');
  check('fetchWeek requests regular season (seasontype=2)', parsed.searchParams.get('seasontype') === '2');
  check('fetchWeek requests the right week', parsed.searchParams.get('week') === '4');
}
{
  const fetchImpl = async () => ({ ok: false, status: 503 });
  try {
    await fetchWeek({ season: 2026, week: 4, fetchImpl });
    check('fetchWeek throws on a non-ok response', false);
  } catch (e) {
    check('fetchWeek throws on a non-ok response', e.message.includes('503'));
  }
}

// fetchCurrentWeek: same parsing, but no season/week query params — it asks
// ESPN for whatever week is current rather than a specified one.
{
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => load('week-complete.json') };
  };
  const current = await fetchCurrentWeek({ fetchImpl });
  check('fetchCurrentWeek requests no dates/week params',
    requestedUrl === 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  check('fetchCurrentWeek parses the fixture same as fetchWeek would',
    current.season === 2025 && current.week === 1 && current.games.length === 16);
}
{
  const fetchImpl = async () => ({ ok: false, status: 503 });
  try {
    await fetchCurrentWeek({ fetchImpl });
    check('fetchCurrentWeek throws on a non-ok response', false);
  } catch (e) {
    check('fetchCurrentWeek throws on a non-ok response', e.message.includes('503'));
  }
}

// --- team branding, for the pick form ---
const withTeams = parseScoreboard(load('week-pre.json'));
check('returns a teams list', Array.isArray(withTeams.teams));
check('one entry per team in the week', withTeams.teams.length === withTeams.games.length * 2);
check('teams are deduplicated by abbreviation',
  new Set(withTeams.teams.map((t) => t.abbr)).size === withTeams.teams.length);
check('every game abbreviation resolves to a team',
  withTeams.games.every((g) =>
    withTeams.teams.some((t) => t.abbr === g.home) && withTeams.teams.some((t) => t.abbr === g.away)));
check('every team has a full display name',
  withTeams.teams.every((t) => typeof t.name === 'string' && t.name.includes(' ')));
check('every team has a short name', withTeams.teams.every((t) => t.shortName && t.shortName.length > 0));
check('every team has a logo url',
  withTeams.teams.every((t) => typeof t.logo === 'string' && t.logo.startsWith('https://')));
check('every team has a hex colour',
  withTeams.teams.every((t) => /^[0-9a-f]{6}$/i.test(t.color)));
check('every team has an alternate colour',
  withTeams.teams.every((t) => /^[0-9a-f]{6}$/i.test(t.altColor)));

const sea = withTeams.teams.find((t) => t.abbr === 'SEA');
check('Seattle resolves to its real name', sea && sea.name === 'Seattle Seahawks');
check('Seattle carries its own colour', sea && sea.color.toLowerCase() === '002a5c');

// A team missing branding must not take the whole week down.
const sparse = parseScoreboard({
  season: { year: 2026 }, week: { number: 1 },
  events: [{ id: '9', date: '2026-09-13T17:00Z', competitions: [{
    status: { type: { completed: false } },
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'AAA' } },
      { homeAway: 'away', team: { abbreviation: 'BBB', displayName: 'B Team', logo: 'https://x/b.png', color: 'ffffff' } },
    ] }] }],
});
check('a team with no branding still yields an entry', sparse.teams.length === 2);
check('missing branding falls back to the abbreviation',
  sparse.teams.find((t) => t.abbr === 'AAA').name === 'AAA');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
