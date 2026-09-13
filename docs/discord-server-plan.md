# The OGs Server

A Discord server for a NYC friend group of anime watchers and gamers. Design
principle throughout: **public shell, private core** — grow the shell, protect
the core.

This document describes the server **as it actually is**. Where an earlier plan
was abandoned, the reason is recorded, because the reasons are the useful part.

---

## 1. Structure

Every channel carries an emoji so the sidebar is scannable. Discord lowercases
text channel names and turns spaces into hyphens, so a heavy bar `┃` separates
the icon from the name; voice channel names are left alone by Discord and take a
plain space.

The **plain slug** is each channel's identity — topics and guides are keyed by
it, and lookups normalize the decoration away — so emoji can be changed freely
in `scripts/discord/channel-names.mjs` without breaking anything.

```
📋 START HERE        📌┃welcome-rules  🚪┃onboarding  📣┃announcements
💬 GENERAL           💬┃general-chat  🏟️┃sports-talk  🎬┃pop-culture
                     🌙┃deep-thoughts  ⭐┃highlights  🔊 General Voice
🗽 NYC               📍┃irl-plans  🥪┃bodega-tier-list  🚇┃mta-complaints
🎮 GAMES             🔎┃lfg  🏀┃2k  🎯┃cod  🏈┃madden  👊┃fighting-games
                     🔊 2K Voice  🔊 CoD Voice  🔊 Madden Voice
                     🔊 Fighting Games Voice
📺 ANIME             🌸┃anime  📆┃currently-watching  📖┃manga
                     🧭┃recommendations  🎴┃gacha  🔊 Watch Party
🏆 SEASON + TOURNAMENTS
                     📊┃season-leaderboard  📝┃pickem  🗂️┃brackets
                     🕹️┃game-of-the-month
🐐 FANTASY           🏈┃nfl-fantasy-forum  🏀┃nba-fantasy-forum  📈┃standings
                     ⚖️┃trade-court  🔊 Draft Night
🔞 AFTER HOURS       💨┃smoke-lounge                    (18+ only)
🛡️ MOD               🧰┃mod-chat  📕┃warn-log  🔗┃invite-tracking   (private)
🔒 OG                🥇┃og-chat  🗺️┃og-plans  🏛️┃og-hall-of-fame
                     🔊 OG Voice                                    (private)
```

Every text channel opens with a **pinned post explaining what it's for**; the two
forums use Discord's Guidelines field instead, plus filterable tags. Both live in
`scripts/discord/channel-guides.mjs` and are applied by `npm run seed`.

No channel inherits from its category at run time, which is why confining a
bot means touching all 44 channels rather than one category — see §4.

---

## 2. Roles

Top to bottom as they sit in Discord:

| Role | Who | Notes |
|---|---|---|
| `OG` | Was in the group chat before the server went public | Never earnable. Not a grind, and asking doesn't move it. |
| `Veteran` | Earned over time | The rank everyone else works toward. Currently unused. |
| `Mod` | Trusted members | Kick, ban, timeout, manage messages, manage threads, manage nicknames, view audit log, and mute / deafen / move in voice. Deliberately **not** Manage Server. |
| `Member` | Passed a week | Promoted automatically from `New Member` by the Worker's daily cron. |
| `New Member` | Just joined | Applied by Carl-bot autorole. |
| `Watch Party` | Self-assigned | Pinged when a watch starts. |
| Game roles | Self-assigned via Onboarding | `2K`, `CoD`, `Madden`, `Fighting Games` — `/lfg` pings these. |
| Borough roles | Self-assigned | Bronx, Brooklyn, Manhattan, Queens, Staten Island. |
| `18+` | Onboarding age question only | **Never** a reaction role — that would let anyone grant themselves access to age-restricted content. |
| `Automod Exempt` | Granted alongside `Mod` | No permissions at all. Exists because Carl-bot's exemption list refuses any role that carries permissions — see §4. |

**The borderline-member rule, in writing:** `OG` means you were in the group chat
before the server went public. Full stop. Everyone else earns `Veteran`.

---

## 3. Bots

| Bot | Does | Where |
|---|---|---|
| **OG Bot** (custom) | `/lfg`, `/picks`, `/leaderboard`, `/award`, the weekly pick'em cron, `New Member` → `Member` promotion | `worker/` — a Cloudflare Worker |
| **Carl-bot** | Autorole, reaction roles, starboard (⭐×3 → `⭐┃highlights`), logging, automod | carl.gg dashboard |
| **Sesh** | Event creation and RSVPs | `📍┃irl-plans` |
| **Karuta** | Collectible card game | Confined to `🎴┃gacha` — see §4 |
| **Chip** ×3 | Music, slash commands, three instances | All voice rooms |

**OG Bot is an HTTP-interaction bot, not a gateway bot.** Discord calls the
Worker's URL with a signed request when someone runs a command. It shows as
*Offline* in the member list and that is correct — there is no connection to
hold open, which is exactly why it runs free with no always-on host.

An earlier design had `/lfg` create a **disposable voice channel** per session
and delete it when empty. That was abandoned: Discord's REST API exposes one
user's voice state but never a list, so nothing without a gateway connection can
tell whether a room has emptied. Standing rooms — one per game — sidestep it
entirely. The gateway bot that implemented the old design has been deleted.

Deliberately **not** installed: Dyno or MEE6 — Carl-bot already covers logging,
automod, autorole, reaction roles, starboard and levelling, and two mod bots
means double-logging and conflicting rules.

### Music

Wanted, reversing an earlier decision to skip it. The category is unusually
unstable: Groovy and Rythm, the two largest music bots ever made, were shut
down in 2021 after Google's lawyers objected to them streaming from YouTube,
and everything since works the same way. Whatever is installed can disappear
without notice, so nothing should depend on it.

**The requirement that decides this choice is multiple instances.** A music bot
occupies one voice channel at a time. With eight voice rooms, a single-instance
bot is whoever-asked-first's, and everybody else waits.

**[Chip](https://chipbot.gg/) ×3 is what's installed** — `Chip`, `Chip 2`,
`Chip 3`. Slash commands, so `/play <song>` for a quick play and
`/search <song>` when the title is ambiguous: that one returns a clickable list
with each result's artist and duration, which is how you tell Wiz Khalifa's
"See You Again" from Miley Cyrus's. Also filters, `/247`, DJ roles, lyrics and
queue tools. Discord lists it as a verified app in 1.9 million servers.

**Jockie was installed first and has been removed.** It worked, but it is
prefix-only (`m!`) — no slash commands, confirmed by typing `/play` in the
server and by its own 227-command list. Picking a specific track took two
messages instead of one click. Running both meant seven music bots answering to
two different prefixes, which is how someone types the wrong one and concludes
music is broken.

What went with it: Jockie's **Guess the Song** trivia game (`m!gts`) and saved
collections, neither of which Chip has. If the trivia game is ever wanted for
🕹️┃game-of-the-month, re-adding one Jockie takes two minutes.

**Neither bot does type-ahead suggestion of song names while typing.** Tested
directly on both. Discord supports it; the bot has to implement it and neither
does. `/search` and its clickable result list is the substitute, and it is the
reason to prefer Chip.

**Invite links request Administrator. Strip it.** Chip's official invite carries
`permissions=274914692360`, which includes Administrator — enough to read
🛡️ MOD and 🔒 OG and override every overwrite in §4, for a bot that plays songs.
All three Chips were invited with `274914692352` instead, the same value minus
that one bit, and Discord's confirmation screen then listed exactly nine
permissions: View Channels, Send Messages, Send Messages in Threads, Embed
Links, Read Message History, Connect, Speak, Use Voice Activity, Priority
Speaker. Verified working on that set — playback included. Expect to do this for
any bot: the elevated request is laziness on the developer's part, not a
requirement.

**Durable alternatives for `🔊 Watch Party`:** Discord's own Watch Together
activity and Spotify's Listen Along. No cease-and-desist can take those away,
which is worth something in a category where the two biggest names died
overnight.

**No music bot needs permission setup.** Every bot is already shut out of MOD,
OG and AFTER HOURS by those channels' own overwrites — see §4 — and everywhere
else is where a music bot belongs.

---

## 4. Discord permission gotchas

Three things cost real time to discover. They are also in the code comments, but
they belong here too.

**Role permissions are a union of allows.** Removing View Channel from a bot's
own role subtracts nothing while `@everyone` still grants it. Only an explicit
**deny** overwrite restricts anything.

**Categories do not grant permissions to their channels at run time.** Syncing
*copies* overwrites down once; a channel that isn't synced keeps its own set
forever. Every channel here was created with its own list, so a deny placed on a
category reaches none of them. `confineCardBot` in the setup script therefore
writes the deny to **every channel individually** — all 44 — with an allow on
`🎴┃gacha`.

**Carl-bot's automod exemption list excludes any role carrying permissions.** So
`Mod` cannot be added to it. The alternative — granting `Mod` Manage Server, the
permission Carl does auto-exempt — would also let mods add bots and rename the
server. Hence the permission-less `Automod Exempt` role.

Also worth knowing: a PATCH replaces a channel's **entire** overwrite list, so
anything editing one must read the current list and merge. That arithmetic lives
in `scripts/discord/permissions.mjs` with tests.

Which bots get confined is data, in `scripts/discord/bot-scopes.mjs`. Only bots
that need it are listed: every bot is *already* excluded from MOD, OG and AFTER
HOURS, because those channels deny `@everyone` View Channel and then name the
roles that get it back — and a bot's role is never among them. So that list is
about noise and about bots that read message content, not about privacy from
the private rooms. Karuta is there because it uses `k!` prefix commands, which
means it reads every message in every channel it can see; a bot that only needs
to stay out of the private areas needs no entry and no setup.

---

## 5. Automod and logging

Carl-bot logs to `📕┃warn-log`: deletes, edits, purges, joins and leaves, role
changes, nickname and avatar changes, bans, unbans, timeouts. Voice events are
off — with eight standing voice rooms they would bury everything else.

Automod, all set to delete the message only:

- Discord invite links
- 6+ mentions in 10 seconds
- 10+ messages in 5 seconds

**Caps and word filters are deliberately off.** A caps filter on a server whose
main room is `🏀┃2k` would fire twenty times a night. The premise is trash talk.

---

## 6. Season points

One leaderboard fed by everything: pick'em, meme-of-the-week, aux battles,
tournament placements, fantasy finishes.

The pick'em is built and live (`worker/`): NFL confidence picks, rank 1..N, N
varying with byes. Picks lock at the first kickoff of the week. A week is scored
**only** when every game in it is final — a half-finished week is never scored,
which is why the leaderboard stays quiet mid-week by design. Scoring posts
standings to `📊┃season-leaderboard`, and the first scored week of a season also
fires a one-off `@everyone` post to `📝┃pickem`.

**The order of that job is deliberate and was wrong once.** Writing a week's
winners is what advances the open week, so it happens *last* — after both posts
have succeeded. Under the original order the write came first, which made the
posts unrepeatable: a Discord failure mid-run left the week marked scored, the
next day's run found nothing to score, and the standings and the one-shot ping
were gone with only a log line nobody reads. Scoring now reads the week's
results from memory, posts, and only then commits, so any failure simply
retries the next morning. Retrying safely needs the posts to be idempotent, and
the games table cannot record that — writing to it is what ends the week — so a
`meta` table holds done-markers, one per post, each written the moment its post
lands.

The two jobs on the daily trigger — promotions and the pick'em — each carry
their own error handling, so a failure in one cannot cancel the other. They
were a single unguarded sequence once, which meant a rate-limited member fetch
could silently cost the season its launch.

**Everything the pick'em cannot score goes through `/award`.** Tournament
placements, meme of the week, aux battles, fantasy finishes — the plan always
promised the board was fed by all of them, and for a while only the pick'em
could reach it. A `points` table now holds an append-only ledger: who, how
many, what for, who awarded it, when. Two awards to one person are ordinary; a
correction is a second row with a negative amount. Nothing is overwritten, so
the board can always be explained by reading the rows that built it.

Awards are merged into the standings *after* they are built, never through
them, because a row in the pick'em table also counts as a week entered. Winning
a bracket is not a week of pick'em, and someone who wins one without ever
picking a game belongs on the board with zero weeks rather than credited with
having entered all of them.

`/award` is gated twice — hidden by `default_member_permissions` from anyone
without Manage Messages, and checked again in the handler, because that default
can be overridden per server in Integrations. Its reply is public: a season
point handed out quietly is one nobody can question.

**`/leaderboard` shows the standings on demand**, because before it they only
existed inside the weekly post — award someone points on a Sunday and nobody
saw it until Tuesday. It counts only weeks below the open one, so a total never
drifts during a Sunday afternoon, and it shares one `scoreSeason` with the
weekly job so the two cannot disagree about what someone has scored.

---

## 7. What is not automated

- **Safety Setup** — the server-wide verification level. No API exists.
- **Onboarding questions** — `PUT /guilds/{id}/onboarding` could do it; the
  questions are worth deciding by hand. Currently live and assigning game and
  borough roles correctly.
- **Assigning `OG`** — a manual human call is the entire point of the role.
- **Custom emoji** — needs image files.

---

## 8. Still to build

- **Fantasy phase**: `/standings` pulling Sleeper (NFL) and ESPN (NBA) into one
  embed, plus a Tuesday recap with scores, biggest blowout and worst bench
  decision. Blocked until the leagues exist — NFL missed its 2026 window, NBA
  drafts in October.
- **Trade court** automation: a 24h fair / collusion / robbery vote. Works fine
  manually with reactions until someone forgets to tally.
- **Invite tracking**: `🔗┃invite-tracking` is empty. Only matters once the
  server opens to people you don't know.
- **`🕹️┃game-of-the-month` has no mechanism.** Jockie's Guess the Song was the
  candidate and left with Jockie. Either it earns a new one or it folds into
  `🏆 SEASON + TOURNAMENTS`.

---

## 9. Running things

Every script prompts for the bot token, hidden as you paste it, and never puts
it in shell history. `GUILD_ID` and `BOT_TOKEN` in the environment skip the
prompts.

| Command | Does | When |
|---|---|---|
| `npm test` | The whole suite, no token needed | Before anything |
| `npm run setup` | Roles, channels, permissions, bot scoping | Rebuilding the server |
| `npm run seed` | Channel guides, forum guidelines and tags | After editing `channel-guides.mjs` |
| `npm run register` | Tells Discord about the slash commands | After changing `shared/commands.mjs` |
| `npm run backup` | Exports the database to `backups/` | After a week scores |
| `npm run emoji` | Uploads every image in `emoji/` | After adding images |

`register` and `seed` are the two that catch people out. Discord keeps its own
copy of the command list, so a new command does not exist until `register`
runs; and `seed` edits its own pinned post in place rather than adding a
second, so re-running it is safe and re-running it is also the only way an
edited guide reaches the server.

**Backups.** Cloudflare's Time Travel already restores the database to a point
in time — `wrangler d1 time-travel info og-pickem` prints the bookmark. The
export covers what that cannot: the account going away, the retention window
passing, or reading a season's data somewhere that is not Cloudflare. It
refuses a dump that is empty or missing a table, because a backup nobody opens
until the day they need it is worse than none, and it keeps nothing when the
data has not changed since the last one.
