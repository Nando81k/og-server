# Discord server setup script

`setup-server.mjs` builds out the full structure from
[`docs/discord-server-plan.md`](../../docs/discord-server-plan.md) in one run:
every category, every channel, every role — including locking the `OG` and
`AFTER HOURS` categories so `@everyone` can't see into them. It's idempotent,
so re-running it after adding more channels by hand won't duplicate anything.

## 1. Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is your `BOT_TOKEN`. No privileged
   gateway intents are needed — this script only makes plain REST calls.
3. **OAuth2 → URL Generator** → scope: `bot` → permission: `Administrator`
   (simplest for a one-time setup; strip the bot back down to fewer permissions,
   or kick it entirely, once you're done — or keep it around as the base for
   the LFG/standings bots from Phase 2).
4. Open the generated URL, pick your server, authorize.

## 2. Get your server ID

Discord app → **User Settings → Advanced → Developer Mode** (turn it on) → right-click
your server's icon → **Copy Server ID**. That's `GUILD_ID`.

## 3. Run it

```bash
BOT_TOKEN=your-bot-token GUILD_ID=your-server-id node scripts/discord/setup-server.mjs
```

Requires Node 18+ (uses the built-in `fetch`). No dependencies to install.

## What it does NOT do

On purpose — these need a human, not an API call:

- **Onboarding questions** (Server Settings → Onboarding) — the games/borough/interest
  picker that auto-assigns roles on join.
- **Safety Setup** (Server Settings → Safety Setup) — confirming age-restricted
  content is on for `#smoke-lounge`.
- **Assigning the `OG` role** to your actual crew. Never automate this one — the
  whole point of OG is that it's a manual, human judgment call.
