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
| **OG Bot** (custom) | `/lfg`, `/picks`, the weekly pick'em cron, `New Member` → `Member` promotion | `worker/` — a Cloudflare Worker |
| **Carl-bot** | Autorole, reaction roles, starboard (⭐×3 → `⭐┃highlights`), logging, automod | carl.gg dashboard |
| **Sesh** | Event creation and RSVPs | `📍┃irl-plans` |
| **Karuta** | Collectible card game | Confined to `🎴┃gacha` — see §4 |

**OG Bot is an HTTP-interaction bot, not a gateway bot.** Discord calls the
Worker's URL with a signed request when someone runs a command. It shows as
*Offline* in the member list and that is correct — there is no connection to
hold open, which is exactly why it runs free with no always-on host.

An earlier design had `/lfg` create a **disposable voice channel** per session
and delete it when empty. That was abandoned: Discord's REST API exposes one
user's voice state but never a list, so nothing without a gateway connection can
tell whether a room has emptied. Standing rooms — one per game — sidestep it
entirely. The gateway bot that implemented the old design has been deleted.

Deliberately **not** installed: Dyno or MEE6 (Carl-bot already covers logging,
automod, autorole, reaction roles, starboard and levelling — two mod bots means
double-logging and conflicting rules), and music bots.

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

---

## 5. Automod and logging

Carl-bot logs to `📕┃warn-log`: deletes, edits, purges, joins and leaves, role
changes, nickname and avatar changes, bans, unbans, timeouts. Voice events are
off — with five standing voice rooms they would bury everything else.

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
