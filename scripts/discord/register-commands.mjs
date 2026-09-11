#!/usr/bin/env node
/**
 * Registers /lfg with Discord. Run once, and again whenever the command's
 * shape changes — not on every deploy.
 *
 *   node scripts/discord/register-commands.mjs
 *
 * Application ID is on the Developer Portal's General Information page.
 */

import { askVisible, askHidden } from './prompt.mjs';
import { COMMANDS } from '../../shared/commands.mjs';

// stdin alone decides this: stdout is piped under `npm run`, but the
// keyboard is still there and prompts go to stderr.
const interactive = Boolean(process.stdin.isTTY);

let APP_ID = process.env.APPLICATION_ID;
if (!APP_ID && interactive) APP_ID = await askVisible('Application ID: ');

let GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID && interactive) GUILD_ID = await askVisible('Server ID: ');

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
