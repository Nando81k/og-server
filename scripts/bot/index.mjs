/**
 * The OG server's own bot. Two jobs, both things no off-the-shelf bot does
 * the way this server wants:
 *
 *   /lfg  - spin up a temporary voice channel, ping the game's role, and
 *           clean the channel up once it empties out.
 *   promotion - move New Member to Member once someone has been around a week.
 *
 * Setup:
 *   1. Discord Developer Portal -> your application -> Bot
 *      -> turn ON "Server Members Intent". The promotion job reads join dates,
 *         and Discord will not send them without it.
 *   2. Invite the bot with: Manage Channels, Manage Roles, Move Members,
 *      Send Messages, and Use Application Commands.
 *   3. Drag its role above Member and New Member, or it cannot assign them.
 *   4. node scripts/bot/index.mjs
 *      It asks for the server id and the token; the token stays hidden.
 *      Set BOT_TOKEN and GUILD_ID in the environment to skip both prompts.
 */

import {
  Client,
  Events,
  GatewayIntentBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';

import { askVisible, askHidden } from '../discord/prompt.mjs';

import {
  GAME_ROLES,
  TEMP_PREFIX,
  tempChannelName,
  isTempChannel,
  shouldDelete,
  isDueForPromotion,
  clampSlots,
} from './lib.mjs';

const AFTER_DAYS = Number(process.env.MEMBER_AFTER_DAYS ?? 7);
const GRACE_MS = 5 * 60 * 1000; // an empty room gets 5 minutes before it goes
const SWEEP_MS = 5 * 60 * 1000;
const PROMOTE_MS = 6 * 60 * 60 * 1000;

// Prompted for when absent, same as the setup script: nothing to paste a
// credential into by mistake, and nothing landing in shell history.
const interactive = process.stdin.isTTY && process.stdout.isTTY;

let GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID && interactive) {
  GUILD_ID = await askVisible('Server ID (right-click the server icon -> Copy Server ID): ');
}

let TOKEN = process.env.BOT_TOKEN;
if (!TOKEN && interactive) {
  TOKEN = await askHidden('Bot token (paste it — nothing will appear — then press Enter): ');
}

if (!TOKEN || !GUILD_ID) {
  console.error(
    'Need a bot token and a server ID. Run this in a terminal to be prompted for both,\n' +
      'or set BOT_TOKEN and GUILD_ID in the environment for an unattended run.'
  );
  process.exit(1);
}

// Channel id -> when we made it, so an empty room is not killed instantly.
const created = new Map();

const command = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Start a session and pull people in')
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('What are you running?')
      .setRequired(true)
      .addChoices(
        { name: '2K', value: '2k' },
        { name: 'CoD', value: 'cod' },
        { name: 'Madden', value: 'madden' },
        { name: 'Fighting Games', value: 'fgc' }
      )
  )
  .addIntegerOption((o) =>
    o.setName('slots').setDescription('How many people total (default 5)').setRequired(false)
  );

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

function findCategory(guild, name) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
}

function findRole(guild, name) {
  return guild.roles.cache.find((r) => r.name === name);
}

async function handleLfg(interaction) {
  const game = interaction.options.getString('game');
  const slots = clampSlots(interaction.options.getInteger('slots') ?? 5);
  const guild = interaction.guild;
  const roleName = GAME_ROLES[game];
  const role = findRole(guild, roleName);

  const channel = await guild.channels.create({
    name: tempChannelName(game),
    type: ChannelType.GuildVoice,
    parent: findCategory(guild, 'GAMES') ?? null,
    userLimit: slots,
    reason: `/lfg by ${interaction.user.tag}`,
  });
  created.set(channel.id, Date.now());

  // The ping is the point — without it this is just a voice channel.
  const ping = role ? `<@&${role.id}>` : roleName;
  await interaction.reply(
    `${ping} — ${interaction.user} is running **${roleName}**, ${slots} slots.\n` +
      `Jump in: <#${channel.id}>`
  );
}

async function sweepChannels(guild) {
  const now = Date.now();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice || !isTempChannel(channel.name)) continue;
    // A channel we did not create (left over from a restart) is fair game now.
    const createdAt = created.get(channel.id) ?? 0;
    if (!shouldDelete({ memberCount: channel.members.size, createdAt, now, graceMs: GRACE_MS })) {
      continue;
    }
    try {
      await channel.delete('empty LFG room');
      created.delete(channel.id);
    } catch (err) {
      console.warn(`could not delete ${channel.name}: ${err.message}`);
    }
  }
}

async function runPromotions(guild) {
  const newMember = findRole(guild, 'New Member');
  const member = findRole(guild, 'Member');
  if (!newMember || !member) {
    console.warn('New Member or Member role is missing — skipping promotions.');
    return;
  }

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    console.warn(
      `Could not read the member list (${err.message}). ` +
        'Turn on "Server Members Intent" in the Developer Portal.'
    );
    return;
  }

  const now = Date.now();
  for (const m of members.values()) {
    if (!m.roles.cache.has(newMember.id)) continue;
    if (!isDueForPromotion({ joinedAt: m.joinedTimestamp, now, afterDays: AFTER_DAYS })) continue;
    try {
      await m.roles.add(member, `${AFTER_DAYS} days in the server`);
      await m.roles.remove(newMember, `${AFTER_DAYS} days in the server`);
      console.log(`Promoted ${m.user.tag} to Member.`);
    } catch (err) {
      console.warn(`Could not promote ${m.user.tag}: ${err.message}`);
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), {
    body: [command.toJSON()],
  });
  console.log('/lfg registered.');

  const guild = await c.guilds.fetch(GUILD_ID);
  const full = await guild.fetch();

  const tick = async () => {
    try {
      await sweepChannels(full);
    } catch (err) {
      console.warn(`sweep failed: ${err.message}`);
    }
  };
  await tick();
  setInterval(tick, SWEEP_MS);

  const promote = async () => {
    try {
      await runPromotions(full);
    } catch (err) {
      console.warn(`promotion pass failed: ${err.message}`);
    }
  };
  await promote();
  setInterval(promote, PROMOTE_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'lfg') return;
  try {
    await handleLfg(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: `Could not start that: ${err.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
    else await interaction.reply(msg);
  }
});

// Someone leaving is the usual way a room empties, so check right then rather
// than waiting up to five minutes for the sweep.
client.on(Events.VoiceStateUpdate, async (before) => {
  const channel = before.channel;
  if (!channel || !isTempChannel(channel.name)) return;
  if (channel.members.size > 0) return;
  try {
    await channel.delete('last person left the LFG room');
    created.delete(channel.id);
  } catch {
    /* the sweep will get it */
  }
});

// Most hosts expect something listening on a port and will kill a process that
// never binds one. A bot has no reason to serve HTTP, so this only runs when a
// host asks for it by setting PORT, and it doubles as a health check.
if (process.env.PORT) {
  const { createServer } = await import('node:http');
  createServer((req, res) => {
    const up = client.isReady();
    res.writeHead(up ? 200 : 503, { 'Content-Type': 'text/plain' });
    res.end(up ? `ok, logged in as ${client.user.tag}\n` : 'starting\n');
  }).listen(Number(process.env.PORT), () => {
    console.log(`Health check listening on :${process.env.PORT}`);
  });
}

client.login(TOKEN);
