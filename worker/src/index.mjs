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
import { verifyPickToken, signPickToken } from './token.mjs';
import { renderForm, renderMessage } from './form.mjs';
import { validateSubmission, lockTime } from './validate.mjs';
import { getGames, getPicks, savePicks, openWeek } from './db.mjs';

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
    // Handled before anything Discord-specific: Discord never calls /picks —
    // a browser does, with no signature — so this must not sit behind the
    // POST-only gate or the Ed25519 signature check below.
    const url = new URL(request.url);
    if (url.pathname === '/picks') {
      const claims = await verifyPickToken(
        request.method === 'POST' ? (await request.clone().json()).token : url.searchParams.get('t'),
        env.PICKS_SECRET
      );
      if (!claims) {
        return new Response(renderMessage('That link has expired — run /picks again.'), {
          status: 401, headers: { 'Content-Type': 'text/html' },
        });
      }
      const games = await getGames(env.DB, claims.season, claims.week);

      if (request.method === 'GET') {
        const picks = await getPicks(env.DB, claims.userId, claims.season, claims.week);
        return new Response(
          renderForm({ games, picks, token: url.searchParams.get('t'), lockAt: lockTime(games) }),
          { headers: { 'Content-Type': 'text/html' } }
        );
      }

      const submitted = await request.json();
      const result = validateSubmission({ games, submission: submitted.picks, now: Date.now() });
      if (!result.ok) return json({ error: result.error }, 400);
      await savePicks(env.DB, {
        userId: claims.userId, season: claims.season, week: claims.week, picks: result.picks,
      });
      return json({ ok: true });
    }

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

    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'picks') {
      const userId = interaction.member?.user?.id ?? interaction.user?.id;
      const season = Number(env.SEASON);
      const week = await openWeek(env.DB, season);
      if (!week) {
        return json({ type: REPLY, data: { content: 'No week is open right now.', flags: 64 } });
      }
      const games = await getGames(env.DB, season, week);
      const exp = lockTime(games);
      if (Date.now() >= exp) {
        return json({ type: REPLY, data: { content: `Week ${week} is locked.`, flags: 64 } });
      }
      const token = await signPickToken({ userId, season, week, exp }, env.PICKS_SECRET);
      const link = `${url.origin}/picks?t=${token}`;
      return json({ type: REPLY, data: { content: `Your Week ${week} picks: ${link}`, flags: 64 } });
    }

    return json({ type: REPLY, data: { content: 'Not something I handle.', flags: 64 } });
  },

  async scheduled(event, env) {
    const api = createApi(env.DISCORD_TOKEN);
    const result = await runPromotions(env, api);
    console.log(`Promotion pass: ${result.promoted} promoted, ${result.skipped} not due yet.`);
  },
};
