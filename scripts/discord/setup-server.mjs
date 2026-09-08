#!/usr/bin/env node
/**
 * One-time Discord server setup for the NYC gamer crew server.
 *
 * Creates every category, channel, and role from docs/discord-server-plan.md,
 * sets the role hierarchy, gives Mod real moderation powers, flags #smoke-lounge
 * as age-restricted, and locks down the OG and After Hours categories so
 * @everyone can't see into them. Safe to re-run — it skips anything that
 * already exists by name.
 *
 * Usage:
 *   node scripts/discord/setup-server.mjs
 *
 * It prompts for the server ID and the bot token (the token stays hidden as you
 * paste it, and never reaches your shell history). To run it unattended instead,
 * set BOT_TOKEN and GUILD_ID in the environment and it skips both prompts.
 *
 * Setup (Discord Developer Portal, https://discord.com/developers/applications):
 *   1. New Application -> name it -> Bot tab -> Reset Token, copy it (BOT_TOKEN).
 *      No privileged gateway intents needed; this script only calls the REST API.
 *   2. OAuth2 -> URL Generator -> scope: "bot" -> permission: Administrator
 *      (simplest for a one-time setup bot; you can strip it back down after).
 *   3. Open the generated URL, pick your server, authorize. Then drag the bot's
      role to the top of Server Settings -> Roles: a bot can only order roles
      below its own, and the script says so and skips that step if it can't.
 *   4. The server ID: right-click the server icon in Discord -> Copy Server ID
 *      (enable Settings -> Advanced -> Developer Mode first).
 *
 * Left for the Discord dashboard on purpose (no bot API for these):
 *   - Server Settings -> Onboarding: the games/borough/interest questions
 *   - Server Settings -> Safety Setup: the server-wide age gate
 *   - Assigning the OG role to your actual crew — never automate that one
 */

import { askVisible, askHidden } from './prompt.mjs';

// Both values are prompted for when they aren't already in the environment.
// Asking for the token keeps it out of shell history, and leaves nothing in the
// command someone could paste it into by mistake. The environment variables are
// still honored so a non-interactive run works unchanged.
const interactive = process.stdin.isTTY && process.stdout.isTTY;

let GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID && interactive) {
  GUILD_ID = await askVisible(
    'Server ID (Developer Mode on, right-click the server icon -> Copy Server ID): '
  );
}

let TOKEN = process.env.BOT_TOKEN;
if (!TOKEN && interactive) {
  TOKEN = await askHidden('Bot token (paste it — nothing will appear — then press Enter): ');
}

if (!TOKEN || !GUILD_ID) {
  console.error(
    'Need a bot token and a server ID. Run this in a terminal to be prompted for both,\n' +
      'or set BOT_TOKEN and GUILD_ID in the environment for a non-interactive run.'
  );
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const VIEW_CHANNEL = '1024'; // bit 10

// Mod's actual moderation powers. Without these the role is just a red name.
const MOD_PERMISSIONS = [
  1n << 1n, // KICK_MEMBERS
  1n << 2n, // BAN_MEMBERS
  1n << 7n, // VIEW_AUDIT_LOG
  1n << 13n, // MANAGE_MESSAGES
  1n << 22n, // MUTE_MEMBERS
  1n << 23n, // DEAFEN_MEMBERS
  1n << 24n, // MOVE_MEMBERS
  1n << 27n, // MANAGE_NICKNAMES
  1n << 34n, // MANAGE_THREADS
  1n << 40n, // MODERATE_MEMBERS (timeout)
].reduce((a, b) => a | b, 0n).toString();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discord(method, path, body) {
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const { retry_after } = await res.json();
      await sleep(((retry_after ?? 1) + 0.2) * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
  }
}

const denyView = (id) => ({ id, type: 0, deny: VIEW_CHANNEL, allow: '0' });
const allowView = (id) => ({ id, type: 0, allow: VIEW_CHANNEL, deny: '0' });

// Listed bottom-to-top. Discord does not document where a newly created role
// lands (same-position roles are tie-broken by id), so orderRoles() below sets
// the hierarchy explicitly rather than trusting creation order.
const ROLE_DEFS = [
  { name: '18+', color: 0x992d22 },
  { name: 'Staten Island', color: 0 },
  { name: 'Queens', color: 0 },
  { name: 'Manhattan', color: 0 },
  { name: 'Brooklyn', color: 0 },
  { name: 'Bronx', color: 0 },
  { name: 'Fighting Games', color: 0, mentionable: true },
  { name: 'Madden', color: 0, mentionable: true },
  { name: 'CoD', color: 0, mentionable: true },
  { name: '2K', color: 0, mentionable: true },
  { name: 'New Member', color: 0x99aab5 },
  { name: 'Member', color: 0x99aab5 },
  { name: 'Mod', color: 0xe74c3c, hoist: true, permissions: MOD_PERMISSIONS },
  { name: 'Veteran', color: 0x1abc9c, hoist: true },
  { name: 'OG', color: 0xf1c40f, hoist: true },
];

// A bot can only move roles below its own, so the block is stacked directly
// under the bot's highest role instead of at a fixed position.
async function orderRoles(roleIds) {
  try {
    const me = await discord('GET', '/users/@me');
    const [member, roles] = await Promise.all([
      discord('GET', `/guilds/${GUILD_ID}/members/${me.id}`),
      discord('GET', `/guilds/${GUILD_ID}/roles`),
    ]);
    const positionById = new Map(roles.map((r) => [r.id, r.position]));
    const botTop = Math.max(0, ...member.roles.map((id) => positionById.get(id) ?? 0));
    const ceiling = botTop - 1; // highest slot the bot is allowed to write

    if (ceiling < ROLE_DEFS.length) {
      console.warn(
        `\n! Skipped role ordering: the bot's own role sits at position ${botTop}, too low` +
          ` to stack ${ROLE_DEFS.length} roles beneath it.\n` +
          `  Fix: Server Settings -> Roles, drag the bot's role to the top, then re-run.\n` +
          `  Everything else still applied — role order only affects name color and hoisting.\n`
      );
      return;
    }

    await discord(
      'PATCH',
      `/guilds/${GUILD_ID}/roles`,
      ROLE_DEFS.map((def, i) => ({
        id: roleIds[def.name],
        position: ceiling - ROLE_DEFS.length + 1 + i,
      }))
    );
    console.log('Role order set: OG highest, 18+ lowest.');
  } catch (err) {
    console.warn(`! Could not set role order (${err.message}). Drag them in Server Settings -> Roles.`);
  }
}

const TEXT = 0;
const VOICE = 2;
const FORUM = 15;

async function main() {
  console.log('Reading existing roles + channels...');
  const [existingRoles, existingChannels] = await Promise.all([
    discord('GET', `/guilds/${GUILD_ID}/roles`),
    discord('GET', `/guilds/${GUILD_ID}/channels`),
  ]);

  const roleByName = new Map(existingRoles.map((r) => [r.name, r]));
  const everyoneId = GUILD_ID; // @everyone's role id is always the guild id

  const roleIds = {};
  for (const def of ROLE_DEFS) {
    let role = roleByName.get(def.name);
    if (!role) {
      console.log(`Creating role: ${def.name}`);
      role = await discord('POST', `/guilds/${GUILD_ID}/roles`, {
        name: def.name,
        color: def.color ?? 0,
        hoist: !!def.hoist,
        mentionable: !!def.mentionable,
        permissions: def.permissions ?? '0',
      });
      await sleep(400);
    } else {
      console.log(`Role exists, skipping: ${def.name}`);
    }
    roleIds[def.name] = role.id;
  }

  await orderRoles(roleIds);

  const categoryByName = new Map(
    existingChannels.filter((c) => c.type === 4).map((c) => [c.name, c])
  );
  const channelByKey = new Map(
    existingChannels
      .filter((c) => c.type !== 4)
      .map((c) => [`${c.parent_id ?? ''}:${c.name}`, c])
  );

  async function ensureCategory(name, overwrites) {
    let cat = categoryByName.get(name);
    if (!cat) {
      console.log(`Creating category: ${name}`);
      cat = await discord('POST', `/guilds/${GUILD_ID}/channels`, {
        name,
        type: 4,
        permission_overwrites: overwrites ?? [],
      });
      await sleep(400);
      categoryByName.set(name, cat);
    }
    return cat;
  }

  async function ensureChannel(def, parent, sectionOverwrites) {
    const name = typeof def === 'string' ? def : def.name;
    const type = typeof def === 'string' ? TEXT : def.type ?? TEXT;
    const nsfw = typeof def === 'string' ? false : !!def.nsfw;
    const key = `${parent.id}:${name}`;
    if (channelByKey.has(key)) {
      console.log(`Channel exists, skipping: #${name}`);
      return channelByKey.get(key);
    }
    console.log(`Creating channel: #${name} (${parent.name})`);
    const chan = await discord('POST', `/guilds/${GUILD_ID}/channels`, {
      name,
      type,
      nsfw,
      parent_id: parent.id,
      permission_overwrites: sectionOverwrites ?? [],
    });
    await sleep(400);
    channelByKey.set(key, chan);
    return chan;
  }

  // Mods can see OG space so they can moderate it, without being OGs themselves.
  const ogOverwrites = [denyView(everyoneId), allowView(roleIds['OG']), allowView(roleIds['Mod'])];
  const afterHoursOverwrites = [denyView(everyoneId), allowView(roleIds['18+'])];
  const modOverwrites = [denyView(everyoneId), allowView(roleIds['Mod']), allowView(roleIds['OG'])];

  const PLAN = [
    { category: 'START HERE', channels: ['welcome-rules', 'onboarding', 'announcements'] },
    {
      category: 'GENERAL',
      channels: [
        'general-chat',
        'sports-talk',
        'pop-culture',
        'deep-thoughts',
        'highlights',
        { name: 'General Voice', type: VOICE },
      ],
    },
    { category: 'NYC', channels: ['irl-plans', 'bodega-tier-list', 'mta-complaints'] },
    { category: 'GAMES', channels: ['lfg', '2k', 'cod', 'madden', 'fighting-games'] },
    {
      category: 'SEASON + TOURNAMENTS',
      channels: ['season-leaderboard', 'pickem', 'brackets', 'game-of-the-month'],
    },
    {
      category: 'FANTASY',
      channels: [
        { name: 'nfl-fantasy-forum', type: FORUM },
        { name: 'nba-fantasy-forum', type: FORUM },
        'standings',
        'trade-court',
        { name: 'Draft Night', type: VOICE },
      ],
    },
    {
      category: 'AFTER HOURS',
      channels: [{ name: 'smoke-lounge', nsfw: true }],
      overwrites: afterHoursOverwrites,
    },
    {
      category: 'MOD',
      channels: ['mod-chat', 'warn-log', 'invite-tracking'],
      overwrites: modOverwrites,
    },
    {
      category: 'OG',
      channels: ['og-chat', 'og-plans', 'og-hall-of-fame', { name: 'OG Voice', type: VOICE }],
      overwrites: ogOverwrites,
    },
  ];

  for (const section of PLAN) {
    const cat = await ensureCategory(section.category, section.overwrites);
    for (const chDef of section.channels) {
      await ensureChannel(chDef, cat, section.overwrites);
    }
  }

  console.log('\nDone. Still manual, on purpose:');
  console.log('  - Server Settings -> Onboarding: add games/borough/interest questions');
  console.log('  - Server Settings -> Safety Setup: confirm the server-wide age gate');
  console.log('  - Assign the OG role to your actual crew yourself');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
