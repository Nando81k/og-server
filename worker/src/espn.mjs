export const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export function parseScoreboard(json) {
  const season = json?.season?.year;
  const week = json?.week?.number;

  if (season === undefined) throw new Error('Malformed payload: missing season');
  if (week === undefined) throw new Error('Malformed payload: missing week');

  // Branding for the pick form. Collected here rather than hardcoded so a
  // rebrand or relocation arrives with the next sync instead of needing a code
  // change. Keyed by abbreviation, which is what games rows store.
  const teams = new Map();
  const noteTeam = (t) => {
    if (!t?.abbreviation || teams.has(t.abbreviation)) return;
    teams.set(t.abbreviation, {
      abbr: t.abbreviation,
      // Fall back to the abbreviation rather than dropping the team: a game
      // with one under-described side must still be pickable.
      name: t.displayName ?? t.abbreviation,
      shortName: t.shortDisplayName ?? t.name ?? t.abbreviation,
      logo: t.logo ?? '',
      color: t.color ?? '444444',
      altColor: t.alternateColor ?? t.color ?? '888888',
    });
  };

  const games = (json?.events ?? []).map((event) => {
    const c = event.competitions?.[0];
    if (!c) throw new Error(`Malformed event ${event.id}: missing competitions array`);

    const home = c.competitors.find((t) => t.homeAway === 'home');
    if (!home) throw new Error(`Malformed event ${event.id}: missing home competitor`);

    const away = c.competitors.find((t) => t.homeAway === 'away');
    if (!away) throw new Error(`Malformed event ${event.id}: missing away competitor`);

    noteTeam(home.team);
    noteTeam(away.team);

    const completed = c.status?.type?.completed === true;
    const won = c.competitors.find((t) => t.winner === true);
    return {
      id: String(event.id),
      kickoff: event.date,
      home: home.team.abbreviation,
      away: away.team.abbreviation,
      winner: won ? won.team.abbreviation : null,
      completed,
      // Finished with nobody flagged the winner is a tie. Never inferred
      // from the scores, which can be equal mid-game.
      voided: completed && !won,
    };
  });
  return { season, week, games, teams: [...teams.values()] };
}

export async function fetchWeek({ season, week, fetchImpl = fetch }) {
  const url = `${SCOREBOARD_URL}?dates=${season}&seasontype=2&week=${week}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'og-server' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return parseScoreboard(await res.json());
}

// No dates/week params: ESPN's default scoreboard reports whichever season
// and week are current, which is exactly what's needed to seed the very
// first week (or recover after a sync that never happened) without already
// knowing what week that is. fetchWeek is unchanged — this is a second, tiny
// entry point for that one case.
export async function fetchCurrentWeek({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(SCOREBOARD_URL, { headers: { 'User-Agent': 'og-server' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return parseScoreboard(await res.json());
}
