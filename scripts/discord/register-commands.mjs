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

const commands = [
  {
    name: 'lfg',
    description: 'Start a session and pull people in',
    options: [
      {
        name: 'game',
        description: 'What are you running?',
        type: 3, // string
        required: true,
        choices: [
          { name: '2K', value: '2k' },
          { name: 'CoD', value: 'cod' },
          { name: 'Madden', value: 'madden' },
          { name: 'Fighting Games', value: 'fgc' },
        ],
      },
      {
        name: 'slots',
        description: 'How many people total (default 5)',
        type: 4, // integer
        required: false,
      },
    ],
  },
  { name: 'picks', description: 'Get your link to this week’s pick’em', options: [] },
];

const res = await fetch(
  `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`,
  {
    method: 'PUT',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  }
);

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Registered: ${(await res.json()).map((c) => '/' + c.name).join(', ')}`);
