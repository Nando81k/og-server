/**
 * The backup's table list has to match the schema.
 *
 * backup-db.mjs checks that a dump contains every table before it will call it
 * a backup, which only works if the list it checks against is current. A table
 * added to schema.sql and forgotten here means the backup quietly stops
 * covering it, and nobody finds out until the day they restore — the exact
 * failure the check exists to prevent.
 *
 * Read as text rather than imported, because backup-db.mjs runs on import:
 * importing it here would start talking to Cloudflare.
 */

import { readFileSync } from 'node:fs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const script = readFileSync(new URL('./backup-db.mjs', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');

// The tables the worker actually creates.
const inSchema = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]);

// The tables the backup insists on seeing.
const listed = script.slice(script.indexOf('const TABLES = ['));
const inScript = [...listed.slice(0, listed.indexOf(']')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

console.log('--- the backup checks for every table the schema creates ---');
check('the schema declares tables at all', inSchema.length > 0);
check('the backup lists tables at all', inScript.length > 0);

const missing = inSchema.filter((t) => !inScript.includes(t));
check(`no schema table is unchecked by the backup${missing.length ? ` (missing: ${missing})` : ''}`,
  missing.length === 0);

// The other direction matters too: a name left behind after a table is renamed
// or dropped makes every future backup fail the check and exit 1.
const stale = inScript.filter((t) => !inSchema.includes(t));
check(`the backup checks for no table that no longer exists${stale.length ? ` (stale: ${stale})` : ''}`,
  stale.length === 0);

check(`both lists agree (${inSchema.length} tables)`, inSchema.length === inScript.length);

console.log('\n--- the check itself is still wired up ---');
// If these regress, the list above is correct and enforced by nothing.
check('the export is rejected when empty', /size === 0/.test(script));
check('the export is rejected when a table is missing',
  /missing\.length/.test(script) && /Not a usable backup/.test(script));
check('a missing table exits non-zero', /missing\.length\) \{[\s\S]{0,200}process\.exit\(1\)/.test(script));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
