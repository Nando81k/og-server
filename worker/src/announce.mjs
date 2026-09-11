/**
 * The one-off post that tells the server the pick'em is real.
 *
 * Fires once, immediately after the first week of the season is scored, so it
 * lands underneath a leaderboard people can already see rather than in an
 * empty channel days beforehand. Week 1 can only be scored once — openWeek
 * moves past it the moment every game has a winner — so no "already sent"
 * flag is needed to keep it from repeating.
 *
 * This is the only message the bot sends that pings @everyone. It is worth one
 * ping: most of the server has never opened the pick'em channel, and a season
 * competition nobody enters is not a competition.
 */
export function weekOneAnnouncement({ leaderboardChannelId } = {}) {
  const board = leaderboardChannelId ? `<#${leaderboardChannelId}>` : '#season-leaderboard';
  return `@everyone

**week 1 is gone — don't let week 2 go the same way**

The season is live, and the standings above are the whole story: almost nobody entered.

**How to play:** run \`/picks\` anywhere in the server. You get a private link to your own form. Pick a winner in every game, then rank them by how sure you are — your highest number goes on your lock of the week, 1 goes on the coin flip you're only making because you have to. Correct picks pay out their rank, wrong ones pay nothing, and you can change anything right up until lock.

**The deadline that matters:** picks lock at the *first* kickoff of the week. That's Thursday night, not Sunday. Week 1 locked on Wednesday and most of you never saw the form.

Week 2 is open now and locks at Thursday night's kickoff.

Miss a week and you score zero for it. No makeups, and this runs all season — two zeroes in September decides the whole thing before October.

Standings post to ${board} every week.`;
}

const ET = 'America/New_York';
const etDay = (ms) => new Date(ms).toLocaleDateString('en-US', { timeZone: ET, weekday: 'long' });
const etStamp = (ms) =>
  `${new Date(ms).toLocaleString('en-US', {
    timeZone: ET,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  })} ET`;

/**
 * What `/picks` says when the week it would serve has already locked.
 *
 * openWeek is the lowest week with no winner yet, so from a week's first
 * kickoff until the run that scores it, `/picks` has nothing to hand out —
 * five days, most of a week. A bare "Week 1 is locked." is a dead end at
 * exactly the moment someone is trying the server for the first time, and it
 * reads like the whole season is shut, so say when the next week opens and
 * what to do about it.
 *
 * Days are read off the schedule rather than written in, so this stays true
 * for a week that ends on a Saturday or a Friday, and for a season whose
 * week 1 does not lock on a Wednesday.
 */
export function lockedMessage({ week, games = [], leaderboardChannelId } = {}) {
  const board = leaderboardChannelId ? `<#${leaderboardChannelId}>` : '#season-leaderboard';
  const next = week + 1;
  const kickoffs = games.map((g) => Date.parse(g.kickoff)).filter(Number.isFinite);

  // A locked week with no readable kickoffs shouldn't happen — lockTime would
  // have to have produced the lock from the same rows — but a reply that still
  // points somewhere useful beats a crash inside Math.min.
  if (kickoffs.length === 0) {
    return (
      `**Week ${week} is locked.** Picks close at the first kickoff of the week.\n\n` +
      `Week ${next} opens once Week ${week} finishes — run \`/picks\` again then. ` +
      `Standings post to ${board}.`
    );
  }

  return (
    `**Week ${week} is locked.** Picks closed at ${etStamp(Math.min(...kickoffs))}, ` +
    `the first kickoff of the week. That is always the deadline — not Sunday.\n\n` +
    `**You haven't missed the season.** Week ${next} opens once Week ${week}'s last game ` +
    `is played (${etDay(Math.max(...kickoffs))}) and locks at its own first kickoff. ` +
    `Run \`/picks\` again then and you're in.\n\n` +
    `Standings post to ${board} the morning after a week finishes.`
  );
}
