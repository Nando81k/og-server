# OG Server

Build plan + setup automation for an NYC gamer crew's Discord server — sports,
pop-culture betting, fantasy leagues, deep talk, and an 18+ smoke lounge —
designed to grow from a tight friend group into a wider community without
losing the core.

## What's here

- **[`docs/discord-server-plan.md`](docs/discord-server-plan.md)** — the full
  blueprint: category/channel layout, roles & permissions, bot recommendations,
  the season-points system, NBA/NFL fantasy league structure, and a
  week-by-week rollout order.
- **[`scripts/discord/`](scripts/discord)** — a one-time, idempotent setup
  script that creates every category, channel, and role from the plan via
  Discord's REST API, and locks down the private `OG` and `AFTER HOURS`
  categories. See its [README](scripts/discord/README.md) for how to run it.

## Design principle

**Public shell, private core.** The server opens with a public shell anyone
can join and grow — general chat, games, fantasy leagues, NYC channels — while
a locked `OG` category stays reserved for whoever was in the group chat before
the server ever went public. Every step toward "community" trades away a
little friend-group looseness; the tiered access model is the compromise.
