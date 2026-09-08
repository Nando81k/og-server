# The OG server bot

Two jobs that no off-the-shelf bot does the way this server wants:

- **`/lfg`** — someone runs `/lfg game:2K slots:4`, the bot makes a temporary
  voice channel under GAMES, pings `@2K`, and deletes the channel once the last
  person leaves. Nothing to clean up afterwards.
- **Promotion** — `New Member` becomes `Member` after a week. This is the piece
  Discord's Onboarding genuinely cannot do, and the reason both roles exist.

## Setup

**1. Reuse or make a bot application**

Developer Portal → your application → **Bot**.

**Turn on "Server Members Intent."** The promotion job reads join dates, and
Discord withholds them without it. Everything else works if you forget, so the
symptom is silent: promotions simply never happen. The bot logs a clear warning
when this is the problem.

**2. Invite it**

OAuth2 → URL Generator → scope `bot` and `applications.commands`, with:

- Manage Channels — to make and delete the LFG rooms
- Manage Roles — to swap New Member for Member
- Send Messages, Use Application Commands

**3. Position its role**

Server Settings → Roles → drag the bot **above `Member` and `New Member`**.
A bot cannot assign a role at or above its own, and this is the single most
common reason a working bot appears to do nothing.

**4. Run it**

```bash
npm install
node scripts/bot/index.mjs
```

It asks for the server id, then the token. The token stays hidden as you paste
it, so it never appears on screen or in your shell history.

For an unattended run on a host, set `BOT_TOKEN` and `GUILD_ID` in the
environment instead and both prompts are skipped. Optional:
`MEMBER_AFTER_DAYS` (default `7`).

## Where to run it

Unlike the setup script, this one has to stay running — a closed laptop is a
dead bot. It needs an always-on host with Node 18+, and it is small enough for
the smallest tier of anything: a hosting service's cheapest plan, a small VPS,
or a Raspberry Pi on your own network all work equally well.

It holds no database and writes no files, so there is nothing to back up and
nothing lost on a restart — it re-reads everything from Discord on boot,
including sweeping up any LFG rooms left behind while it was down.

Whatever you use, three settings:

| Setting | Value |
|---|---|
| Start command | `node scripts/bot/index.mjs` |
| `BOT_TOKEN` | the bot's token |
| `GUILD_ID` | the server id |

Set those as the host's environment variables. Never commit the token — `.env`
and `node_modules/` are already gitignored.

**If the host expects a web service.** This is a worker: it connects out to
Discord and listens on nothing, and some platforms kill a process that never
binds a port. Set `PORT` and the bot starts a tiny health endpoint alongside
itself — `200` once it is logged in, `503` while it is still starting. Leave
`PORT` unset anywhere that doesn't need it and no server is started at all.

## Tests

```bash
npm test
```

Covers the naming, cleanup timing, promotion eligibility and slot clamping, and
checks that every discord.js symbol the bot imports actually exists in the
installed version. It does not talk to Discord, so it needs no token.
