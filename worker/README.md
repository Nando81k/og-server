# The bot, as a Cloudflare Worker

Same two jobs as `scripts/bot/`, with no machine that has to stay awake.

Instead of the bot holding a connection open to Discord, **Discord calls this
endpoint** when someone runs `/lfg`. Nothing runs in between, so it fits inside
Cloudflare's free plan and never sleeps in a way that matters.

## What changed, and why

The gateway bot created a temporary voice room per session and deleted it once
the last person left. That is not possible here: Discord's REST API can report
**one** user's voice state but never list a channel's occupants, so nothing
without a live connection can tell whether a room has emptied. Deleting on a
timer instead would eventually cut off a session that was still going.

So `/lfg` points at a **standing voice room per game** — `2K Voice`,
`CoD Voice`, `Madden Voice`, `Fighting Games Voice`, created by the setup
script. It pings the role, says who is running what and how many slots, and
links the room. Nothing to clean up, and nobody gets disconnected.

The promotion pass is unchanged: a daily cron reads join dates and swaps
`New Member` for `Member`.

If you would rather have per-session rooms with real slot limits, use
`scripts/bot/` instead — it does exactly that, and needs an always-on host.

## Deploy

**1. Install the CLI and log in**

```bash
npm install -g wrangler
wrangler login
```

**2. Put your server id in `wrangler.toml`** under `[vars]`.

**3. Add the two secrets**

```bash
cd worker
wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
```

`DISCORD_PUBLIC_KEY` is on the Developer Portal's **General Information** page.
Secrets are never written to the repo.

**4. Deploy**

```bash
wrangler deploy
```

It prints a URL like `https://og-server-bot.<you>.workers.dev`.

**5. Hand that URL to Discord**

Developer Portal → your application → **General Information** →
**Interactions Endpoint URL** → paste it → **Save Changes**.

Discord immediately sends a signed ping and a deliberately invalid one. It only
accepts the endpoint if the good one gets a `PONG` and the bad one gets a `401`.
If it refuses, the public key is wrong.

**6. Register the command** (once, not per deploy)

```bash
node ../scripts/discord/register-commands.mjs
```

## ESPN fantasy basketball

Three things, all off until you give it a league:

- **`/fantasy standings | scores | recent`** — the league table, this week's
  matchups, and the latest moves, read live from ESPN.
- **A live feed in `#standings`** — every add, drop and trade, posted within
  about ten minutes of it happening on ESPN. A second cron (`*/10 * * * *`)
  runs only this; the daily one is untouched.
- **No Python.** Workers can't run the `espn-api` library, so `src/fantasy.mjs`
  makes the same HTTP calls directly.

**1. Find the league id** — it's the number after `leagueId=` in your ESPN
league URL. Put it in `wrangler.toml` as `FANTASY_LEAGUE_ID`. `FANTASY_SEASON`
is the year the season *ends* in, so 2026-27 is `2027`.

**2. Set the feed channel** — right-click `#standings` → Copy Channel ID →
`FANTASY_CHANNEL_ID`. Not `#trade-court` (that's the server's vote on proposed
trades) and not a forum channel (the bot can't post to those).

**3. Private league? Add your ESPN cookies as secrets.** Log into ESPN in
Chrome → DevTools → Application → Cookies → `espn.com`, copy `espn_s2` and
`SWID`:

```bash
cd worker
wrangler secret put ESPN_S2
wrangler secret put ESPN_SWID
```

These are your ESPN login. They go in Cloudflare secrets only — never in
`wrangler.toml`, never in chat. They expire, and when they do the feed fails
with a 401 that shows up as a failed cron invocation: re-run the two commands
above with fresh values.

**4. Deploy and register the new command**

```bash
wrangler deploy
node ../scripts/discord/register-commands.mjs
```

The first feed run only records what's already in the league, so turning it on
doesn't dump the league's history into the channel. Moves after that post once
each.

**Not verified against a live league.** The tests use fixtures shaped like
ESPN's responses, because the league is private. The first real run is the real
test: `wrangler tail` while you run `/fantasy standings`. If ESPN has changed a
field, the parser throws a "Malformed payload" error rather than posting junk.

## Fantasy trades

Propose a trade, let the server vote, and have the bot close it out. The bot
only records and reports: a trade is still made in ESPN, by the two managers.

**Once per manager:** `/fantasy link` and pick your team. It's a claim, not
proof, and one person per team. A mod can reassign a wrong one with the `user`
option.

**To trade:** `/trade propose` with the other team and up to three players a
side (autocomplete lists the real rosters). The card goes to `TRADE_CHANNEL_ID`
with Fair / Collusion / Robbery buttons, and the other manager is pinged. The
two managers can't vote; everyone else can, anonymously, and can change their
vote until it closes.

**How it ends** (after `TRADE_VOTE_HOURS`, default 24, checked every ten
minutes by the fantasy cron):

| Result | When |
|---|---|
| Approved | At least 3 votes, Fair is the top choice, and neither Collusion nor Robbery has a third |
| Flagged for mods | Collusion or Robbery reaches a third of the votes, or Fair isn't on top |
| Not enough votes | Fewer than 3 votes |

Mods settle flagged and no-vote trades with `/trade approve` or `/trade veto`
(also usable on any open trade). When ESPN processes a matching trade, the
card flips to "Completed in ESPN" on its own. A player in an open trade can't
be in a second one.

The thresholds are constants at the top of `src/trade.mjs` (`QUORUM`, and the
one-third rule in `decide`).

**Deploying this change adds three tables**, so apply the schema once:

```bash
cd worker
wrangler d1 execute og-pickem --remote --file=./schema.sql
wrangler deploy
node ../scripts/discord/register-commands.mjs
```

The schema file is safe to re-run. `#trade-court`'s pinned post is written by
hand and isn't touched; add a line to it pointing people at `/trade propose`.

**Not verified against a live league.** The tests use fixtures shaped like
ESPN's responses. The parts to watch on first use are the roster lists in the
autocomplete, and a processed trade flipping its card to completed.

## Checking the bot against the real league

Parts of this bot are built on what the `espn-api` library shows ESPN sends,
not on a league it could be run against. `/fantasy debug` (mods only) asks
ESPN for one player and the league settings and reports what is really there:
the scoring format and categories, the trade-settings fields, which stat
windows and seasons come back, whether game-by-game logs exist, whether
ownership and rank are present, and whether the public bio page answers.

It prints field names and counts, never cookies or account details, and only
the mod who ran it sees the reply. Run it once after deploying and keep the
output: it is what the stats charts and the trade-impact estimate get built
against.

## What the real league told us

`/fantasy debug` against the real league (before the draft) settled several
guesses, and the bot now follows them:

- **The league scores 8 categories, with no turnovers** (head-to-head, most
  categories won). Tables, the net and the Explore panel show only the
  categories in the league's own settings; if the settings can't be read they
  fall back to all nine.
- **Before the first game** a player's card shows ESPN's projection beside last
  season, not last season alone.
- **`/player` finds anyone**, drafted or not, using ESPN's player search from
  three letters on (confirmed working). Players on a team in the league are
  always matched locally and show their team.
- **Confirmed:** the trade deadline field, ownership percentage, the last
  7/15/30 windows, game-by-game logs, and the bio page (height, weight, age;
  not college or experience).
- **Not available:** per-season stats further back than last season came back
  empty, so a multi-season chart would need another source.

## The /player card and /compare

`/player` replies with a Discord embed rather than plain text: the colour bar
is his health (green healthy, amber day-to-day, red out), with his headshot, a
row of rank / ownership / owner in your league, a bio line, the per-game table,
and an **area chart of his last 15 games** (points, with the average as a
dashed line).

- The per-game table is a code block of box-drawing characters with ruled
  lines and right-aligned numbers, about 36 characters wide so it fits a phone.
  Discord can't draw a real table, so this is the closest to a spreadsheet.

- The chart is an image drawn by **QuickChart** (quickchart.io) from a URL this
  bot builds. QuickChart sees only the per-game numbers and the chart styling,
  never a token, cookie or anything about the server. If it is ever down the
  card simply has no picture.
- Before the season the games are last season's, and the chart is titled as
  such ("last 15 games of 2025-26") rather than passed off as recent form.
- The headshot comes from ESPN's image host by player id and is **not
  verified**; if it is missing, Discord just shows no thumbnail.
- The game-by-game entries are read as that game's totals under the same stat
  ids as the averages (the debug run confirmed 15 come back with totals). How
  ESPN orders them is not confirmed, so they are sorted by scoring period when
  every game has one.

**`/compare`** puts two to four players side by side. One column per player,
one row per category the league scores, the best value in each row starred
(ties both starred), a *Basis* row saying whether each column is this season, a
projection or last season, and a *Leads* row counting the categories each leads
(the league is decided by categories won). The chart overlays their recent
games, latest games lined up at the right. Four players' numbers are close to
the URL limit, so the chart steps down from 15 games to 10, 7 or 5 rather than
overflow. If the columns are on different bases the footer says to read the
leads loosely.

## Practice drafts

A mock draft run entirely in Discord. **Nothing is ever sent to ESPN.**

1. A mod runs `/draft start [rounds] [clock]`: a lobby is posted listing every
   team in the league.
2. Managers press **Join** (or `/draft join`). A team needs a `/fantasy link`
   first, which is how the bot knows which team is yours. Any team nobody joins
   is drafted by a bot.
3. A mod presses **Begin draft** (or `/draft begin`). The order is drawn at
   random, the player pool (the top 250 by ESPN's ADP) is frozen for the whole
   draft, and the lobby message becomes a pinned **board** edited after every
   pick: who is on the clock, a countdown, the last six picks and the best
   available players.
4. On your turn use `/draft pick` (the best available are listed first; any
   player in the pool can be typed) or press **Draft best available**. **My
   roster** and **Full board** are private views.

Snake order. Bots take one of the best five available by ADP, weighted towards
the top (50/25/12/8/5 percent) so two practice drafts are not the same draft.
Bot picks happen straight away; a person gets the clock, and if it runs out the
best available is picked for them.

**The clock** is checked once a minute by a third cron trigger
(`* * * * *`), so an expired clock is acted on within about a minute, not to
the second. The check does one cheap query and returns when no draft is
running. `src/index.mjs` matches the trigger by exact string (`DRAFT_CRON`), so
it must match `wrangler.toml`; an unrecognised cron string falls through to the
daily job.

Draft commands answer immediately with "working..." and finish in the
background, because a pick can mean several bot picks and Discord calls, which
will not always fit Discord's three-second window.

**Deploying this adds tables**, so apply the schema once:

```bash
cd worker
wrangler d1 execute og-pickem --remote --file=./schema.sql
wrangler deploy
node ../scripts/discord/register-commands.mjs
```

Run `/fantasy debug` afterwards: it now reports how many draftable players ESPN
returns and how many have an ADP, which is what the pool is built from.

### The live board for the real draft

`/draft live` (mod) posts one board in the channel it is run in and follows the
league's **real** ESPN draft. Picks are still made in ESPN; the board only
mirrors them.

- Before the draft: when it starts and the pick order. After: round and pick,
  who is on the clock, the last six picks and the best available (from the
  same top-250 ADP pool, so it is a guide, not ESPN's own list).
- The minute job asks ESPN's `mDraftDetail` view, so the board is up to about a
  minute behind. A minute with nothing new costs one ESPN call and no Discord
  call; the pick count last drawn is stored in the `live_draft` table, and it
  is saved *before* Discord is told, so a slow post can never double-announce.
- New picks are announced in one message, and whoever is on the clock is pinged
  if they have linked their team with `/fantasy link`. Starting it mid-draft
  does not replay picks already made.
- **My roster** and **Full board** are private, like the mock draft's. There is
  no pick button: this is not the place to draft.
- `/draft live-off` stops it; it also stops itself when ESPN says the draft is
  done.

What is assumed, not confirmed: ESPN does not publish the pick countdown, so
none is shown, and the number of rounds is taken from the league's roster slot
count. If the board shows the wrong number of rounds, run `/draft live rounds:N`.
`/fantasy debug` now has a "Real draft" line showing exactly what ESPN reports
(phase, picks, order, seconds a pick, roster slots, start time); check it once
before draft night.

## Tests

```bash
npm test
```

Signature verification is checked against real Ed25519 keys, including the bad
signatures Discord sends when registering an endpoint. Nothing talks to Discord,
so no token is needed.
