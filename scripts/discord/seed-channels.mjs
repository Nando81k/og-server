#!/usr/bin/env node
/**
 * Posts and pins a "what is this channel for" guide at the top of each text
 * channel, so a newcomer can tell what a room is without asking.
 *
 * Safe to re-run. For each channel it looks at the existing pins:
 *   - a pinned guide of its own, unchanged  -> left alone
 *   - a pinned guide of its own, now edited -> updated in place
 *   - a pin written by a person             -> left alone, never overwritten
 *   - nothing pinned                        -> posted and pinned
 *
 * The eight channels seeded by hand earlier are listed in ALREADY_PINNED and
 * skipped outright, so this can never duplicate them.
 *
 * Usage:
 *   node scripts/discord/seed-channels.mjs
 *   DRY_RUN=1 node scripts/discord/seed-channels.mjs   # print, change nothing
 *
 * Prompts for the server ID and bot token; the token stays hidden as you paste
 * it and never reaches your shell history. Set GUILD_ID and BOT_TOKEN in the
 * environment to run it unattended.
 */

import { askVisible, askHidden } from './prompt.mjs';
import { normalizeChannelName } from '../bot/lib.mjs';
import {
  GUIDES,
  FORUM_GUIDELINES,
  FORUM_TAGS,
  ALREADY_PINNED,
  renderGuide,
} from './channel-guides.mjs';

const DRY_RUN = process.env.DRY_RUN === '1';
const interactive = Boolean(process.stdin.isTTY);

let GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID && interactive) {
  GUILD_ID = await askVisible('Server ID: ');
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discord(method, path, body) {
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const { retry_after } = await res.json();
      await sleep(((retry_after ?? 1) + 0.2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
}

/**
 * Discord has served pins as a bare array and, more recently, as
 * `{ items: [{ message }] }`. Accept either rather than guessing.
 */
async function pinnedMessages(channelId) {
  const body = await discord('GET', `/channels/${channelId}/pins`);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items.map((i) => i.message ?? i);
  return [];
}

const me = await discord('GET', '/users/@me');
const channels = await discord('GET', `/guilds/${GUILD_ID}/channels`);

// Guides are keyed by plain slug; the live channels carry emoji. Match on the
// normalized name so decoration never orphans a guide.
const idBySlug = new Map();
const channelBySlug = new Map();
for (const slug of [
  ...Object.keys(GUIDES),
  ...Object.keys(FORUM_GUIDELINES),
  ...Object.keys(FORUM_TAGS),
]) {
  const wanted = normalizeChannelName(slug);
  const hit = channels.find((c) => normalizeChannelName(c.name) === wanted);
  if (hit) {
    idBySlug.set(slug, hit.id);
    channelBySlug.set(slug, hit);
  }
}
// Cross-references may point at channels that have no guide of their own.
for (const c of channels) idBySlug.set(normalizeChannelName(c.name), c.id);

let posted = 0;
let updated = 0;
let skipped = 0;
let missing = 0;

for (const [slug, template] of Object.entries(GUIDES)) {
  if (ALREADY_PINNED.includes(slug)) continue;

  const channelId = idBySlug.get(slug);
  if (!channelId) {
    console.warn(`! No channel found for #${slug} — skipping.`);
    missing += 1;
    continue;
  }

  const content = renderGuide(template, idBySlug);

  let pins;
  try {
    pins = await pinnedMessages(channelId);
  } catch (err) {
    console.warn(`! Could not read pins in #${slug}: ${err.message}`);
    skipped += 1;
    continue;
  }

  const ours = pins.find((m) => m?.author?.id === me.id);
  const theirs = pins.find((m) => m?.author?.id !== me.id);

  if (!ours && theirs) {
    console.log(`Someone already pinned a post in #${slug} — leaving it alone.`);
    skipped += 1;
    continue;
  }

  if (ours && ours.content === content) {
    console.log(`Already current: #${slug}`);
    skipped += 1;
    continue;
  }

  if (ours) {
    console.log(`${DRY_RUN ? '[dry run] ' : ''}Updating guide in #${slug}`);
    if (!DRY_RUN) {
      await discord('PATCH', `/channels/${channelId}/messages/${ours.id}`, { content });
      await sleep(400);
    }
    updated += 1;
    continue;
  }

  console.log(`${DRY_RUN ? '[dry run] ' : ''}Posting guide in #${slug}`);
  if (!DRY_RUN) {
    const msg = await discord('POST', `/channels/${channelId}/messages`, {
      content,
      allowed_mentions: { parse: [] },
    });
    await sleep(400);
    await discord('PUT', `/channels/${channelId}/pins/${msg.id}`);
    await sleep(400);
  }
  posted += 1;
}

// Forums take their explainer as Guidelines rather than a pinned message.
let guidelines = 0;
for (const [slug, template] of Object.entries(FORUM_GUIDELINES)) {
  const channel = channelBySlug.get(slug);
  if (!channel) {
    console.warn(`! No channel found for #${slug} — skipping.`);
    missing += 1;
    continue;
  }

  const topic = renderGuide(template, idBySlug);
  if (channel.topic === topic) {
    console.log(`Already current: #${slug} guidelines`);
    skipped += 1;
    continue;
  }

  console.log(`${DRY_RUN ? '[dry run] ' : ''}Setting guidelines on #${slug}`);
  if (!DRY_RUN) {
    await discord('PATCH', `/channels/${channel.id}`, { topic });
    await sleep(400);
  }
  guidelines += 1;
}

// Tags make a forum filterable instead of a flat list of titles.
let tagged = 0;
for (const [slug, wanted] of Object.entries(FORUM_TAGS)) {
  const channel = channelBySlug.get(slug);
  if (!channel) {
    console.warn(`! No channel found for #${slug} — skipping.`);
    missing += 1;
    continue;
  }

  const existing = channel.available_tags ?? [];
  const same =
    existing.length === wanted.length &&
    wanted.every((t, i) => existing[i]?.name === t.name && existing[i]?.emoji_name === t.emoji);
  if (same) {
    console.log(`Already current: #${slug} tags`);
    skipped += 1;
    continue;
  }

  // Keep the id of a tag that already exists under the same name. A tag
  // recreated with a fresh id would be silently stripped from every post
  // already carrying it.
  const byName = new Map(existing.map((t) => [t.name, t]));
  const available_tags = wanted.map((t) => {
    const prev = byName.get(t.name);
    return {
      ...(prev ? { id: prev.id } : {}),
      name: t.name,
      emoji_name: t.emoji,
      emoji_id: null,
      moderated: false,
    };
  });

  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Setting ${available_tags.length} tags on #${slug}: ` +
      wanted.map((t) => t.name).join(', ')
  );
  if (!DRY_RUN) {
    await discord('PATCH', `/channels/${channel.id}`, { available_tags });
    await sleep(400);
  }
  tagged += 1;
}

console.log(
  `\n${DRY_RUN ? '[dry run] ' : ''}Posted ${posted}, updated ${updated}, ` +
    `guidelines set ${guidelines}, forums tagged ${tagged}, left alone ${skipped}` +
    `${missing ? `, no channel for ${missing}` : ''}.`
);
if (DRY_RUN) console.log('Nothing was changed. Re-run without DRY_RUN=1 to apply.');
