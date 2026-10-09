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

## Tests

```bash
npm test
```

Signature verification is checked against real Ed25519 keys, including the bad
signatures Discord sends when registering an endpoint. Nothing talks to Discord,
so no token is needed.
