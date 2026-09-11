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

Week 2 is open now and locks Thursday. That's about 48 hours.

Miss a week and you score zero for it. No makeups, and this runs all season — two zeroes in September decides the whole thing before October.

Standings post to ${board} every week.`;
}
