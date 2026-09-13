#!/usr/bin/env node
/**
 * Registers /lfg with Discord. Run once, and again whenever the command's
 * shape changes — not on every deploy.
 *
 *   node scripts/discord/register-commands.mjs
 *
 * The application and server ids come from shared/ids.mjs, so the only thing
 * this asks for is the bot token.
 */

import { askHidden } from './prompt.mjs';
import { COMMANDS } from '../../shared/commands.mjs';
import { GUILD_ID as DEFAULT_GUILD, APPLICATION_ID as DEFAULT_APP } from '../../shared/ids.mjs';

// stdin alone decides this: stdout is piped under `npm run`, but the
// keyboard is still there and prompts go to stderr.
const interactive = Boolean(process.stdin.isTTY);

// Both are public and live in shared/ids.mjs; the environment still wins, so
// a test bot or another server is one prefix away.
const APP_ID = process.env.APPLICATION_ID || DEFAULT_APP;
const GUILD_ID = process.env.GUILD_ID || DEFAULT_GUILD;

let TOKEN = process.env.BOT_TOKEN;
if (!TOKEN && interactive) {
  TOKEN = await askHidden('Bot token (paste it — nothing will appear — then press Enter): ');
}

if (!APP_ID || !GUILD_ID || !TOKEN) {
  console.error('Need APPLICATION_ID, GUILD_ID and BOT_TOKEN.');
  process.exit(1);
}

const res = await fetch(
  `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`,
  {
    method: 'PUT',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(COMMANDS),
  }
);

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Registered: ${(await res.json()).map((c) => '/' + c.name).join(', ')}`);
