/**
 * The OG server bot, as a Cloudflare Worker.
 *
 * Discord calls this endpoint when someone runs /lfg, rather than the bot
 * holding a connection open — which is what lets it run on a free plan with no
 * always-on machine.
 *
 * Two entry points:
 *   fetch()     - slash commands, arriving as signed HTTPS requests
 *   scheduled() - the daily pass promoting New Member to Member
 */

import { isFromDiscord } from './verify.mjs';
import { createApi } from './rest.mjs';
import { GAME_ROLES, voiceRoomFor, isDueForPromotion, clampSlots } from '../../scripts/bot/lib.mjs';

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const REPLY = 4;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function optionsOf(interaction) {
  const out = {};
  for (const o of interaction?.data?.options ?? []) out[o.name] = o.value;
  return out;
}

export async function handleLfg(interaction, env, api) {
  const { game, slots } = optionsOf(interaction);
  const roleName = GAME_ROLES[game];
  if (!roleName) return { content: 'Unknown game.', flags: 64 };

  const count = clampSlots(slots ?? 5);
  const roomName = voiceRoomFor(game);

  const [roles, channels] = await Promise.all([api.roles(env.GUILD_ID), api.channels(env.GUILD_ID)]);
  const role = roles.find((r) => r.name === roleName);
  const room = channels.find((c) => c.name === roomName);
  const who = interaction.member?.user?.id ?? interaction.user?.id;

  const ping = role ? `<@&${role.id}>` : roleName;
  const where = room ? `<#${room.id}>` : roomName;

  return {
    content: `${ping} — <@${who}> is running **${roleName}**, ${count} slots.\nJump in: ${where}`,
    allowed_mentions: { parse: [], roles: role ? [role.id] : [], users: who ? [who] : [] },
  };
}

export async function runPromotions(env, api, now = Date.now()) {
  const afterDays = Number(env.MEMBER_AFTER_DAYS ?? 7);
  const roles = await api.roles(env.GUILD_ID);
  const newMember = roles.find((r) => r.name === 'New Member');
  const member = roles.find((r) => r.name === 'Member');
  if (!newMember || !member) {
    console.warn('New Member or Member role missing — skipping promotions.');
    return { promoted: 0, skipped: 0 };
  }

  const members = await api.members(env.GUILD_ID);
  let promoted = 0;
  let skipped = 0;

  for (const m of members) {
    if (!m.roles?.includes(newMember.id)) continue;
    const joinedAt = m.joined_at ? Date.parse(m.joined_at) : null;
    if (!isDueForPromotion({ joinedAt, now, afterDays })) {
      skipped += 1;
      continue;
    }
    try {
      await api.addRole(env.GUILD_ID, m.user.id, member.id);
      await api.removeRole(env.GUILD_ID, m.user.id, newMember.id);
      promoted += 1;
    } catch (err) {
      console.warn(`Could not promote ${m.user?.id}: ${err.message}`);
    }
  }
  return { promoted, skipped };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('This endpoint is for Discord interactions.', { status: 405 });
    }

    // Read the body as text: the signature covers the exact bytes sent.
    const body = await request.text();
    const ok = await isFromDiscord({
      publicKey: env.DISCORD_PUBLIC_KEY,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'),
      body,
    });
    // Discord registers an endpoint only if bad signatures come back as 401.
    if (!ok) return new Response('invalid request signature', { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response('bad json', { status: 400 });
    }

    if (interaction.type === PING) return json({ type: PONG });

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'lfg') {
      const api = createApi(env.DISCORD_TOKEN);
      try {
        return json({ type: REPLY, data: await handleLfg(interaction, env, api) });
      } catch (err) {
        console.error(err);
        return json({ type: REPLY, data: { content: `Could not start that: ${err.message}`, flags: 64 } });
      }
    }

    return json({ type: REPLY, data: { content: 'Not something I handle.', flags: 64 } });
  },

  async scheduled(event, env) {
    const api = createApi(env.DISCORD_TOKEN);
    const result = await runPromotions(env, api);
    console.log(`Promotion pass: ${result.promoted} promoted, ${result.skipped} not due yet.`);
  },
};
