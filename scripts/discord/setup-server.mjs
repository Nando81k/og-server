#!/usr/bin/env node
/**
 * One-time Discord server setup for the NYC gamer crew server.
 *
 * Creates every category, channel, and role from docs/discord-server-plan.md,
 * attempts the role hierarchy (best-effort — see orderRoles), gives Mod real
 * moderation powers, flags #smoke-lounge
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
 * Not handled here:
 *   - Server Settings -> Safety Setup: the server-wide age gate. No API exists.
 *   - Onboarding questions. PUT /guilds/{id}/onboarding could do it; this
 *     script does not, because the questions are worth deciding by hand.
 *   - Assigning the OG role to your crew — never automate that one.
 */

import { askVisible, askHidden } from './prompt.mjs';
import { normalizeChannelName } from '../bot/lib.mjs';
import {
  TEXT,
  VOICE,
  SERVER_PLAN,
  categoryDisplayName,
  channelDisplayName,
} from './channel-names.mjs';

// Both values are prompted for when they aren't already in the environment.
// Asking for the token keeps it out of shell history, and leaves nothing in the
// command someone could paste it into by mistake. The environment variables are
// still honored so a non-interactive run works unchanged.
// stdin alone decides this: stdout is piped under `npm run`, but the
// keyboard is still there and prompts go to stderr.
const interactive = Boolean(process.stdin.isTTY);

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
  { name: 'Watch Party', color: 0, mentionable: true },
  { name: 'New Member', color: 0x99aab5 },
  { name: 'Member', color: 0x99aab5 },
  { name: 'Mod', color: 0xe74c3c, hoist: true, permissions: MOD_PERMISSIONS },
  { name: 'Veteran', color: 0x1abc9c, hoist: true },
  { name: 'OG', color: 0xf1c40f, hoist: true },
];

// A bot can only move roles below its own, and where a freshly created role
// lands is not documented. So rather than predict either, set the positions,
// then read back what Discord actually did and report that.
async function orderRoles(roleIds) {
  const wanted = ROLE_DEFS.map((d) => d.name).slice().reverse(); // highest first
  const ours = new Set(Object.values(roleIds));

  const readOrder = async () =>
    (await discord('GET', `/guilds/${GUILD_ID}/roles`))
      .filter((r) => ours.has(r.id))
      .sort((a, b) => b.position - a.position || (a.id < b.id ? -1 : 1))
      .map((r) => r.name);

  // Someone may have arranged these by hand already.
  const before = await readOrder();
  if (before.join(' > ') === wanted.join(' > ')) {
    return { ok: true, actual: before, wanted };
  }

  try {
    const me = await discord('GET', '/users/@me');
    const [member, roles] = await Promise.all([
      discord('GET', `/guilds/${GUILD_ID}/members/${me.id}`),
      discord('GET', `/guilds/${GUILD_ID}/roles`),
    ]);
    const positionById = new Map(roles.map((r) => [r.id, r.position]));
    const botTop = Math.max(0, ...member.roles.map((id) => positionById.get(id) ?? 0));
    // Sit the block directly under the bot; position 0 belongs to @everyone.
    const base = Math.max(1, botTop - ROLE_DEFS.length);

    await discord(
      'PATCH',
      `/guilds/${GUILD_ID}/roles`,
      ROLE_DEFS.map((def, i) => ({ id: roleIds[def.name], position: base + i }))
    );
  } catch (err) {
    console.warn(`! Role ordering request was rejected: ${err.message}`);
  }

  const actual = await readOrder();
  return { ok: actual.join(' > ') === wanted.join(' > '), actual, wanted };
}

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

  const order = await orderRoles(roleIds);

  // Keyed on the normalized name so a channel is still recognised after it has
  // been decorated with an emoji — otherwise a re-run would build a second copy
  // of every channel alongside the originals.
  const categoryByName = new Map(
    existingChannels.filter((c) => c.type === 4).map((c) => [normalizeChannelName(c.name), c])
  );
  const channelByKey = new Map(
    existingChannels
      .filter((c) => c.type !== 4)
      .map((c) => [`${c.parent_id ?? ''}:${normalizeChannelName(c.name)}`, c])
  );

  let renamed = 0;

  /** Bring an existing channel up to its display name, if it has drifted. */
  async function renameIfNeeded(channel, wanted) {
    if (channel.name === wanted) return channel;
    try {
      const updated = await discord('PATCH', `/channels/${channel.id}`, { name: wanted });
      console.log(`Renamed: ${channel.name} -> ${wanted}`);
      renamed += 1;
      await sleep(300);
      channel.name = updated?.name ?? wanted;
    } catch (err) {
      console.warn(`! Could not rename ${channel.name} to ${wanted}: ${err.message}`);
    }
    return channel;
  }

  async function ensureCategory(plain, overwrites) {
    const wanted = categoryDisplayName(plain);
    let cat = categoryByName.get(normalizeChannelName(plain));
    if (!cat) {
      console.log(`Creating category: ${wanted}`);
      cat = await discord('POST', `/guilds/${GUILD_ID}/channels`, {
        name: wanted,
        type: 4,
        permission_overwrites: overwrites ?? [],
      });
      await sleep(400);
      categoryByName.set(normalizeChannelName(plain), cat);
      return cat;
    }
    return renameIfNeeded(cat, wanted);
  }

  const channelIdByName = new Map();

  async function ensureChannel(def, parent, sectionOverwrites) {
    // `plain` stays the channel's identity — TOPICS is keyed by it, and so is
    // channelIdByName. `wanted` is only what the sidebar shows.
    const plain = typeof def === 'string' ? def : def.name;
    const type = typeof def === 'string' ? TEXT : def.type ?? TEXT;
    const nsfw = typeof def === 'string' ? false : !!def.nsfw;
    const wanted = channelDisplayName(plain, type);
    const key = `${parent.id}:${normalizeChannelName(plain)}`;
    if (channelByKey.has(key)) {
      const existing = channelByKey.get(key);
      channelIdByName.set(plain, existing.id);
      if (existing.name === wanted) console.log(`Channel exists, skipping: #${wanted}`);
      else await renameIfNeeded(existing, wanted);
      return existing;
    }
    console.log(`Creating channel: #${wanted} (${parent.name})`);
    const chan = await discord('POST', `/guilds/${GUILD_ID}/channels`, {
      name: wanted,
      type,
      nsfw,
      parent_id: parent.id,
      permission_overwrites: sectionOverwrites ?? [],
    });
    await sleep(400);
    channelByKey.set(key, chan);
    channelIdByName.set(plain, chan.id);
    return chan;
  }

  // Mods can see OG space so they can moderate it, without being OGs themselves.
  const ogOverwrites = [denyView(everyoneId), allowView(roleIds['OG']), allowView(roleIds['Mod'])];
  const afterHoursOverwrites = [denyView(everyoneId), allowView(roleIds['18+'])];
  const modOverwrites = [denyView(everyoneId), allowView(roleIds['Mod']), allowView(roleIds['OG'])];

  // The tree lives in channel-names.mjs; the overwrites need role ids, so they
  // are attached here.
  const OVERWRITES = {
    'AFTER HOURS': afterHoursOverwrites,
    MOD: modOverwrites,
    OG: ogOverwrites,
  };
  const PLAN = SERVER_PLAN.map((section) => ({
    ...section,
    overwrites: OVERWRITES[section.category],
  }));


  for (const section of PLAN) {
    const cat = await ensureCategory(section.category, section.overwrites);
    for (const chDef of section.channels) {
      await ensureChannel(chDef, cat, section.overwrites);
    }
  }

  // A channel with no topic reads as unfinished. These show in the header.
  const TOPICS = {
    'welcome-rules': 'The rules, and what OG means. Read once, then forget it.',
    onboarding: 'Grab your games and your borough. Change them whenever.',
    announcements: 'Server news. Rare on purpose.',
    'general-chat': 'The main room. No topic beyond the pinned one.',
    'sports-talk': 'Knicks, Nets, Yankees, Mets, Jets, Giants. Suffering, mostly.',
    'pop-culture': "Music, shows, movies, whatever's playing.",
    'deep-thoughts': '3am takes. No judgment. Some judgment.',
    highlights: 'The best of the server, picked by ⭐. React to nominate.',
    'irl-plans': 'Actually linking up. Say your borough and when.',
    'bodega-tier-list': 'Serious academic work. Cite your sources.',
    'mta-complaints': 'Therapy.',
    lfg: "Run /lfg to pull people in — it pings the game's role.",
    '2k': 'Park, MyTeam, and arguing about badges.',
    cod: 'Loadouts, clips, and blaming the lobby.',
    madden: 'Franchise, Ultimate Team, and the CPU cheating.',
    'fighting-games': 'Sets, frame data, and getting bodied.',
    anime: 'The main room. Airing, finished, obscure, all of it.',
    'currently-watching': "This season's shows, week by week. Tag your spoilers.",
    manga: 'Manga talk. Assume everyone here is ahead of the anime.',
    recommendations: 'What to watch next. Say why, not just what.',
    gacha: 'Card bots live here so they do not live everywhere else.',
    'season-leaderboard': 'Points from everything. Updated weekly.',
    pickem: 'Weekly picks. Lock them before kickoff.',
    brackets: 'Brackets, seeding, and upsets.',
    'game-of-the-month': "What everyone's playing this month. Vote here.",
    'nfl-fantasy-forum': 'NFL league. One thread per trade, waiver, or grievance.',
    'nba-fantasy-forum': 'NBA league. Same deal.',
    standings: 'Both leagues, one place.',
    'trade-court': 'Propose a trade. 24h vote: fair, collusion, or robbery.',
    'smoke-lounge': '18+ only. Slow down.',
    'mod-chat': 'Mods only.',
    'warn-log': "Written automatically. Don't post here.",
    'invite-tracking': 'Who brought whom.',
    'og-chat': 'The original group chat, continued.',
    'og-plans': "Things that aren't for the whole server yet.",
    'og-hall-of-fame': 'Old memes, original prop bets, pre-server screenshots.',
  };

  let topicsSet = 0;
  for (const [name, topic] of Object.entries(TOPICS)) {
    const id = channelIdByName.get(name);
    if (!id) continue;
    try {
      await discord('PATCH', `/channels/${id}`, { topic });
      topicsSet += 1;
      await sleep(250);
    } catch (err) {
      console.warn(`! Could not set the topic on #${name}: ${err.message}`);
    }
  }
  console.log(`\nChannel topics set: ${topicsSet}. Channels renamed: ${renamed}.`);

  try {
    await discord(
      'PATCH',
      `/guilds/${GUILD_ID}/channels`,
      PLAN.map((section, i) => ({ id: categoryByName.get(section.category)?.id, position: i })).filter(
        (e) => e.id
      )
    );
    console.log('Category order set.');
  } catch (err) {
    console.warn(`! Could not order the categories (${err.message}). Drag ANIME into place.`);
  }

  const WELCOME_SIGN =
    "This was a group chat first. Now it's here. Same people, same energy — " +
    'pick your games, pick your borough, and pull up.';

  // Discord rejects any description over 50 characters, so these stay short.
  const WELCOME_CHANNELS = [
    ['welcome-rules', 'Start here. The rules, and what OG means.', '📌'],
    ['general-chat', 'Where it happens. Come say something.', '💬'],
    ['lfg', 'Find people to run with, right now.', '🎮'],
    ['irl-plans', 'Linking up in the city.', '🗽'],
    ['anime', 'What we are all watching. Spoilers get tagged.', '📺'],
  ];

  try {
    await discord('PATCH', `/guilds/${GUILD_ID}/welcome-screen`, {
      enabled: true,
      description: WELCOME_SIGN,
      welcome_channels: WELCOME_CHANNELS.filter(([name]) => channelIdByName.has(name)).map(
        ([name, description, emoji_name]) => ({
          channel_id: channelIdByName.get(name),
          description,
          emoji_id: null,
          emoji_name,
        })
      ),
    });
    console.log('\nWelcome screen set.');
  } catch (err) {
    console.warn(`\n! Could not set the welcome screen (${err.message}).`);
    console.warn('  Server Settings -> Welcome Screen, if your server has it.');
  }

  if (order.ok) {
    console.log(`\nRole order, top to bottom: ${order.actual.join(' > ')}`);
  } else {
    console.warn('\n! The roles are NOT in the intended order.');
    console.warn(`    now: ${order.actual.join(' > ')}`);
    console.warn(`   want: ${order.wanted.join(' > ')}`);
    console.warn('  A bot can only move roles below its own, so this means the bot sits too low.');
    console.warn('  Fix: Server Settings -> Roles, drag the bot above OG, then re-run this script.');
    console.warn('  Nothing else is affected — order only drives name color and the member list.');
  }

  console.log('\nDone. Not handled here:');
  console.log('  - Server Settings -> Safety Setup: the server-wide age gate. No API for it.');
  console.log('  - Onboarding questions: Discord has an API, this script just does not use it.');
  console.log('  - Assign the OG role to your crew yourself. Never automate that one.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
