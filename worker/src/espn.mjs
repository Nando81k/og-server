export const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export function parseScoreboard(json) {
  const season = json?.season?.year;
  const week = json?.week?.number;
  const games = (json?.events ?? []).map((event) => {
    const c = event.competitions[0];
    const home = c.competitors.find((t) => t.homeAway === 'home');
    const away = c.competitors.find((t) => t.homeAway === 'away');
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
  return { season, week, games };
}

export async function fetchWeek({ season, week, fetchImpl = fetch }) {
  const url = `${SCOREBOARD_URL}?dates=${season}&seasontype=2&week=${week}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'og-server' } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return parseScoreboard(await res.json());
}
