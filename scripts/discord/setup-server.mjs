#!/usr/bin/env node
/**
 * One-time Discord server setup for the NYC gamer crew server.
 *
 * Creates every category, channel, and role from docs/discord-server-plan.md,
 * and locks down the OG and After Hours categories so @everyone can't see
 * into them. Safe to re-run — it skips anything that already exists by name.
 *
 * Usage:
 *   BOT_TOKEN=xxxx GUILD_ID=xxxx node scripts/discord/setup-server.mjs
 *
 * Setup (Discord Developer Portal, https://discord.com/developers/applications):
 *   1. New Application -> name it -> Bot tab -> Reset Token, copy it (BOT_TOKEN).
 *      No privileged gateway intents needed; this script only calls the REST API.
 *   2. OAuth2 -> URL Generator -> scope: "bot" -> permission: Administrator
 *      (simplest for a one-time setup bot; you can strip it back down after).
 *   3. Open the generated URL, pick your server, authorize.
 *   4. GUILD_ID is your server's ID: right-click the server icon in Discord ->
 *      Copy Server ID (enable Settings -> Advanced -> Developer Mode first).
 *
 * Left for the Discord dashboard on purpose (no bot API for these):
 *   - Server Settings -> Onboarding: the games/borough/interest questions
 *   - Server Settings -> Safety Setup: confirm age-restricted content is on
 *   - Assigning the OG role to your actual crew — never automate that one
 */

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('Set BOT_TOKEN and GUILD_ID environment variables first.');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const VIEW_CHANNEL = '1024'; // bit 10

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

// Created bottom-to-top: each new custom role lands above the previous one,
// so this order produces OG at the top of the member list and 18+ near the bottom.
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
  { name: 'Mod', color: 0xe74c3c, hoist: true },
  { name: 'Veteran', color: 0x1abc9c, hoist: true },
  { name: 'OG', color: 0xf1c40f, hoist: true },
];

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
      });
      await sleep(400);
    } else {
      console.log(`Role exists, skipping: ${def.name}`);
    }
    roleIds[def.name] = role.id;
  }

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
    const key = `${parent.id}:${name}`;
    if (channelByKey.has(key)) {
      console.log(`Channel exists, skipping: #${name}`);
      return channelByKey.get(key);
    }
    console.log(`Creating channel: #${name} (${parent.name})`);
    const chan = await discord('POST', `/guilds/${GUILD_ID}/channels`, {
      name,
      type,
      parent_id: parent.id,
      permission_overwrites: sectionOverwrites ?? [],
    });
    await sleep(400);
    channelByKey.set(key, chan);
    return chan;
  }

  const ogOverwrites = [denyView(everyoneId), allowView(roleIds['OG']), denyView(roleIds['Mod'])];
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
    { category: 'AFTER HOURS', channels: ['smoke-lounge'], overwrites: afterHoursOverwrites },
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
  console.log('  - Server Settings -> Safety Setup: confirm age-restricted content is on');
  console.log('  - Assign the OG role to your actual crew yourself');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
