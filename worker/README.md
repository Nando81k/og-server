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

## Tests

```bash
npm test
```

Signature verification is checked against real Ed25519 keys, including the bad
signatures Discord sends when registering an endpoint. Nothing talks to Discord,
so no token is needed.
