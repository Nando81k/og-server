#!/usr/bin/env node
/**
 * Dump the pick'em database to a dated .sql file in backups/.
 *
 *   npm run backup
 *
 * Cloudflare's Time Travel already covers the ordinary disaster — it restores
 * the database to a point in time, and `wrangler d1 time-travel info og-pickem`
 * prints the bookmark to restore to. This exists for the disaster Time Travel
 * cannot help with: the account going away, the retention window passing, or
 * wanting to read a season's data somewhere that isn't Cloudflare.
 *
 * The export is checked before it is called a backup. A file that downloaded
 * but arrived empty, truncated, or missing a table is worse than no backup at
 * all, because nobody looks inside it until the day they need it.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

const DB = 'og-pickem';
/** Every table the worker relies on. A dump missing one is not a backup. */
const TABLES = ['games', 'picks', 'teams', 'meta', 'points'];

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(dir, `${DB}-${stamp}.sql`);

await mkdir(dir, { recursive: true });

console.log(`Exporting ${DB}…`);
try {
  await run(
    'npx',
    ['wrangler', 'd1', 'export', DB, '--remote', `--output=${out}`, '--cwd', 'worker'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 }
  );
} catch (err) {
  console.error(`\nExport failed: ${err.stderr || err.message}`);
  process.exit(1);
}

// Everything below is the point. Wrangler reports success for a download that
// completed, not for a dump that is worth keeping.
const { size } = await stat(out).catch(() => ({ size: 0 }));
if (size === 0) {
  console.error(`\nThe export is empty. Not a usable backup: ${out}`);
  process.exit(1);
}

const sql = await readFile(out, 'utf8');
const missing = TABLES.filter((t) => !new RegExp(`CREATE TABLE\\s+"?${t}"?`, 'i').test(sql));
if (missing.length) {
  console.error(`\nThe export is missing ${missing.join(', ')}. Not a usable backup: ${out}`);
  process.exit(1);
}

const rows = (sql.match(/INSERT INTO/gi) ?? []).length;
const rel = path.relative(root, out);
console.log(`\n${rel}`);
console.log(`${TABLES.length} tables, ${rows} rows, ${(size / 1024).toFixed(1)} KB`);
console.log('\nCommit it to keep a copy off this machine:');
console.log(`  git add ${rel} && git commit -m "backup ${stamp}" && git push`);
console.log('\nTo restore, apply it to an empty database:');
console.log(`  npx wrangler d1 execute ${DB} --remote --file=${rel} --cwd worker`);
