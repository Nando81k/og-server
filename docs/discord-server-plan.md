# Discord Server Blueprint — NYC Gamer Crew

A build plan for a Discord server that starts as a tight friend group (sports, pop-culture
betting, deep-talk, smoke sessions) and can grow into a community without losing the
core. Design principle throughout: **public shell, private core** — grow the shell,
protect the core.

---

## 1. Server structure (categories → channels)

```
📋 START HERE  (public, @everyone)
 ├─ #welcome-rules
 ├─ #onboarding            (Discord's built-in flow: pick games, borough, interests)
 └─ #announcements

💬 GENERAL  (public)
 ├─ #general-chat
 ├─ #sports-talk
 ├─ #pop-culture
 ├─ #deep-thoughts          (life talk, no sports/games allowed — keeps it a real channel)
 └─ #highlights             (shareable: best memes, best takes, tourney results — growth engine)

🏙️ NYC  (public)
 ├─ #irl-plans              (RSVP bot: watch parties, Knicks/Nets, park runs)
 ├─ #bodega-tier-list
 └─ #mta-complaints

🎮 GAMES  (public, role-gated per game via reaction/onboarding menu)
 ├─ #lfg                    (bot channel: /lfg 2k 3, /lfg cod 4, etc.)
 ├─ #2k
 ├─ #cod
 ├─ #madden
 ├─ #fighting-games
 └─ 🔊 Dynamic LFG voice channels (auto-created/deleted by bot)

🏆 SEASON + TOURNAMENTS  (public)
 ├─ #season-leaderboard     (pick'em + memes + aux battles + tournaments → one score)
 ├─ #pickem
 ├─ #brackets               (Challonge-linked brackets for 2K / fighting game tourneys)
 └─ #game-of-the-month

🏈 FANTASY  (public, forum channels — one per league so trash talk doesn't collide)
 ├─ 📌 #nfl-fantasy-forum
 ├─ 📌 #nba-fantasy-forum
 ├─ #standings              (bot: /standings pulls both leagues)
 ├─ #trade-court            (proposed trades voted fair/collusion/robbery, 24h)
 └─ 🔊 Draft Night           (voice + pinned pick-timer message, mirrored in text)

🔞 AFTER HOURS  (18+ age-gated, unlocked after onboarding age check)
 └─ #smoke-lounge            (moved into OG category — see below — but gated 18+ either way)

🛡️ MOD  (private, mod role only)
 ├─ #mod-chat
 ├─ #warn-log
 └─ #invite-tracking

🔒 OG  (private category — deny @everyone View Channel, allow only @OG role)
 ├─ #og-chat
 ├─ #og-plans
 ├─ #og-hall-of-fame        (archive: old memes, original prop bets, pre-community screenshots)
 └─ 🔊 og-voice
      (smoke-lounge lives here too, or stays in its own category with the same
       permission override — either way @everyone is denied and @OG is allowed)
```

**Permission rule of thumb:** set permission overrides at the *category* level, not
per-channel. New channels dropped into a category inherit its overrides automatically.
The OG category denies `View Channel` to `@everyone` and allows it for both `OG`
and `Mod`, so a mod can moderate OG space without having to be an OG.

---

## 2. Roles (top → bottom in the member list)

| Role | Color | Who | Access |
|---|---|---|---|
| `OG` | distinct/bright, near top | Manually assigned. Was in the group chat before the server went public. Never earnable. | Everything, including 🔒 OG category |
| `Veteran` | secondary color | Earned over time (e.g. 6–12 months active) or vouched by an existing member | Some gated channels (define which up front), not the OG category |
| `Mod` | own color, own icon if using role icons | Trusted members you promote | Mod category, warn/timeout powers, and visibility into the OG category so they can moderate it |
| `Member` | default | Passed onboarding | Public shell + unlocked-after-a-week channels |
| `New Member` | default, muted | Just joined | Public channels only until 1 week / vouch |
| Game roles (`2K`, `CoD`, `Madden`, `FGC`) | none needed | Self-assigned via reaction/onboarding menu | Pings + channel visibility for that game only |
| Borough roles (`Bronx`, `Brooklyn`, `Manhattan`, `Queens`, `Staten Island`) | none needed | Self-assigned | Cosmetic + used for "who's nearby" in #irl-plans |
| `18+` | none needed | Self-assigned with a real age gate step in onboarding | Unlocks #smoke-lounge and any NSFW channel |
| Punishment role (e.g. `Fantasy Last Place`) | ugly/embarrassing color | Auto-assigned by fantasy bot | Forced nickname change until next draft |

**Borderline-member rule (decide this now, in writing, so it's never a live argument):**
`OG` = was in the group chat before the server went public. Full stop, no exceptions.
Everyone else — the friend of a friend, the guy active for a year — earns `Veteran`
instead, which grants *some* access, not all.

---

## 3. Bots to install

| Bot | Purpose | Notes |
|---|---|---|
| Discord's built-in **Onboarding** | Pick games / borough / interests on join | No-code, native, good in 2025+ |
| Custom or **Carl-bot** | Reaction-role menu for games + boroughs + 18+ | Carl-bot's reaction roles cover this without custom code |
| Custom **LFG bot** | `/lfg 2k 3` → temp voice channel, pings role, auto-deletes when empty | Small custom bot; simplest is a slash command + `voiceStateUpdate` cleanup check |
| **Sleeper** (official Discord bot) | Posts trades/waivers/matchup scores for the Sleeper league (NFL) | Free, no code, best-in-class for this |
| Custom **League Hub bot** | `/standings` pulls Sleeper (NFL) + ESPN/Yahoo (NBA) into one embed; Tuesday auto-post of week's scores, biggest blowout, worst bench decision | Needs a small script hitting Sleeper's public API + ESPN's unofficial API on a cron |
| Custom **Trade Court** logic | Posts proposed trade, opens a 24h fair/collusion/robbery vote, applies result | Can reuse the same vote-tallying logic as a season-points/bet bot |
| Custom **Season Points bot** | Tracks pick'em, meme contests, aux battles, tournament results, fantasy finishes into one leaderboard | The unifying piece — see §4 |
| **Dyno** or custom mod bot | Warn/timeout log, invite tracking | Set this up *before* you need it |
| Challonge (via API) or custom bracket logic | Tournament brackets for 2K / fighting games | Challonge API is the fast path; reuse bet-bot vote logic if rolling your own |
| RSVP bot (custom or **Sesh**) | Event creation + RSVPs in #irl-plans | Sesh is a solid off-the-shelf option |

---

## 4. Season points — the unifying growth mechanic

One leaderboard, fed by everything:

- Pick'em correct picks
- Meme-of-the-week wins
- Aux battle wins
- Tournament placements (2K, fighting games, game-of-the-month tourney)
- Fantasy football / basketball finishes (big bonus for league champ, punishment role
  for last place until next draft)

Real prize at season end (trophy, IRL dinner, whatever) — this is what gives strangers
a reason to stick around long enough to become community, not just lurkers.

OG-only perks layered on top of the same bot: a special leaderboard tag, tiebreaker
votes on server decisions, first dibs on tournament slots.

---

## 5. Fantasy leagues

- **NFL** on Sleeper — its Discord bot does trades/waivers/scores natively, no code.
- **NBA** on ESPN or Yahoo (Sleeper doesn't do NBA) — pull weekly scores/standings via
  their unofficial APIs on a small cron script.
- Unify both under one `/standings` command and the Tuesday auto-recap
  (scores, blowout, worst bench decision — this is the feature people actually read).
- **Trade court**: proposed trade posts to #trade-court, 24h fair/collusion/robbery
  vote, removes commissioner-veto drama.
- **Draft night mode**: voice channel + pick timer mirrored in text, anonymous
  "grade this pick" reaction per selection.
- Keep the **OG league** locked to OGs. Once the community grows, run a second, open
  league — two leagues means two draft nights, two watch parties, two sets of side
  bets, and keeps OG fantasy trash talk from drowning in newcomers.

---

## 6. Rollout order

1. **Week 1** — Core structure: categories/channels above, roles, OG category locked
   down first (before anyone new ever joins), onboarding flow live, age gate live.
2. **Week 1–2** — Bots: Onboarding + reaction roles, LFG bot, mod bot with warn/timeout
   log, invite tracking on from day one.
3. **Week 2–3** — Season points bot (even in a simple spreadsheet-backed form) live
   before the first pick'em or meme contest, so the habit starts immediately.
4. **Week 3+** — Fantasy integrations (Sleeper for NFL, standings bot pulling
   ESPN/Yahoo for NBA), trade court, draft night mode timed to the actual draft.
5. **Ongoing** — #highlights gets curated weekly; this is the only channel non-members
   ever see get shared outside the server, and it's the actual growth lever.
6. **Before opening the shell publicly** — confirm the OG category permissions are
   correct (test with a throwaway account or a trusted non-OG member) and confirm the
   borderline-member rule (§2) is written down somewhere the group has actually seen.

---

*This is a planning document, not application code — Discord server/role/channel
creation happens in the Discord client or via the Discord API directly, which this
repository does not integrate with.*
