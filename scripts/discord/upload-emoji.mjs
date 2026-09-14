#!/usr/bin/env node
/**
 * Upload every image in emoji/ to the server as a custom emoji.
 *
 *   npm run emoji
 *   DRY_RUN=1 npm run emoji     # say what would happen, upload nothing
 *
 * Drop PNG, JPEG, GIF or WebP files into emoji/ and run it. Each becomes an
 * emoji named after its filename — "big-w.png" becomes :big_w:.
 *
 * Safe to re-run. An emoji that already exists under that name is left alone,
 * so adding one file later does not mean re-uploading the rest.
 *
 * Every file is checked before anything is uploaded. Discord rejects an
 * oversized image with a 400 that does not name the file, and a run that dies
 * halfway leaves the server half-populated with no easy way to tell what
 * landed.
 *
 * Prompts for the server ID and bot token; the token stays hidden as you paste
 * it and never reaches your shell history.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { GUILD_ID as DEFAULT_GUILD } from '../../shared/ids.mjs';
import path from 'node:path';
import { askHidden } from './prompt.mjs';
import { emojiName, mimeFor, rejectReason, isAnimated, EXTENSIONS } from './emoji.mjs';

const DRY_RUN = process.env.DRY_RUN === '1';
const interactive = Boolean(process.stdin.isTTY);
const dir = path.resolve(import.meta.dirname, '..', '..', 'emoji');

let files;
try {
  files = (await readdir(dir)).filter((n) => EXTENSIONS.includes(path.extname(n).toLowerCase()));
} catch {
  console.error(`No emoji/ directory yet. Create one and put images in it:\n  mkdir emoji`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`emoji/ has no images in it. Add ${EXTENSIONS.join(', ')} files and run again.`);
  process.exit(1);
}

// Read and check everything first. Nothing uploads until every file is known
// to be acceptable, so a bad one cannot leave the server half-populated.
const candidates = [];
const rejected = [];
for (const filename of files.sort()) {
  const full = path.join(dir, filename);
  const { size } = await stat(full);
  const reason = rejectReason({ filename, bytes: size });
  if (reason) rejected.push({ filename, reason });
  else candidates.push({ filename, full, size, name: emojiName(filename) });
}

// Two files can reduce to one name — "big w.png" and "big-w.png" both become
// big_w — and Discord would accept both, leaving two emoji nobody can tell
// apart in the picker.
const seen = new Map();
for (const c of candidates) {
  if (seen.has(c.name)) {
    rejected.push({
      filename: c.filename,
      reason: `would be named :${c.name}:, same as ${seen.get(c.name)}`,
    });
    c.skip = true;
  } else {
    seen.set(c.name, c.filename);
  }
}

for (const r of rejected) console.warn(`! ${r.filename} — ${r.reason}`);
const usable = candidates.filter((c) => !c.skip);
if (usable.length === 0) {
  console.error('\nNothing usable to upload.');
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID || DEFAULT_GUILD;

let TOKEN = process.env.BOT_TOKEN;
if (!TOKEN && interactive) {
  TOKEN = await askHidden('Bot token (paste it — nothing will appear — then press Enter): ');
}

if (!TOKEN || !GUILD_ID) {
  console.error('Need a bot token and a server ID.');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discord(method, endpoint, body) {
  for (;;) {
    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const { retry_after } = await res.json();
      await sleep(((retry_after ?? 1) + 0.2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
}

const existing = await discord('GET', `/guilds/${GUILD_ID}/emojis`);
const already = new Set(existing.map((e) => e.name));

// Static and animated emoji draw from separate pools, so a server can be full
// of one and have room for the other. Say which before uploading fails.
const staticUsed = existing.filter((e) => !e.animated).length;
const animatedUsed = existing.filter((e) => e.animated).length;
console.log(`Server has ${staticUsed} static and ${animatedUsed} animated emoji already.\n`);

let uploaded = 0;
let skipped = 0;

for (const c of usable) {
  if (already.has(c.name)) {
    console.log(`Already there: :${c.name}:`);
    skipped += 1;
    continue;
  }

  const kind = isAnimated(c.filename) ? 'animated' : 'static';
  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Uploading :${c.name}: ` +
      `(${c.filename}, ${(c.size / 1024).toFixed(0)} KB, ${kind})`
  );
  if (DRY_RUN) {
    uploaded += 1;
    continue;
  }

  const image = `data:${mimeFor(c.filename)};base64,${(await readFile(c.full)).toString('base64')}`;
  try {
    await discord('POST', `/guilds/${GUILD_ID}/emojis`, { name: c.name, image });
    uploaded += 1;
    await sleep(400);
  } catch (err) {
    // Keep going. One rejected image should not cost the rest of the batch,
    // and the message says which file to look at.
    console.warn(`! ${c.filename} was rejected: ${err.message}`);
  }
}

console.log(
  `\n${DRY_RUN ? '[dry run] ' : ''}Uploaded ${uploaded}, already there ${skipped}` +
    `${rejected.length ? `, unusable ${rejected.length}` : ''}.`
);
if (DRY_RUN) console.log('Nothing was uploaded. Re-run without DRY_RUN=1 to apply.');
