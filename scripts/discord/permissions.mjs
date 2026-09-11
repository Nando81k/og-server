/**
 * Merging permission overwrites without clobbering what is already there.
 *
 * Discord's PATCH replaces a channel's whole overwrite list, so anything that
 * edits one has to read the current list and merge. These helpers do the merge
 * and nothing else, so the arithmetic can be tested without a token.
 *
 * The thing worth knowing: role permissions are a UNION of allows. Removing a
 * permission from a bot's own role subtracts nothing while @everyone still
 * grants it — only an explicit deny overwrite on a channel or category does.
 */

/** VIEW_CHANNEL, bit 10. */
export const VIEW_CHANNEL = 1n << 10n;
/** SEND_MESSAGES, bit 11. */
export const SEND_MESSAGES = 1n << 11n;

const ROLE = 0;
const big = (v) => BigInt(v ?? '0');

/** The overwrite for one id, or undefined. */
export function overwriteFor(overwrites, id) {
  return (overwrites ?? []).find((o) => o.id === id);
}

/** True when `id` is already denied every bit in `bits` and allowed none of them. */
export function isDenied(overwrites, id, bits) {
  const o = overwriteFor(overwrites, id);
  if (!o) return false;
  return (big(o.deny) & bits) === bits && (big(o.allow) & bits) === 0n;
}

/** True when `id` is already allowed every bit in `bits` and denied none of them. */
export function isAllowed(overwrites, id, bits) {
  const o = overwriteFor(overwrites, id);
  if (!o) return false;
  return (big(o.allow) & bits) === bits && (big(o.deny) & bits) === 0n;
}

/**
 * Return a new overwrite list with `bits` denied for `id`, leaving every other
 * entry — and every other bit of this entry — untouched.
 */
export function withDeny(overwrites, id, bits) {
  return upsert(overwrites, id, (allow, deny) => [allow & ~bits, deny | bits]);
}

/** As withDeny, but allowing. An allow always wins over a deny of the same bit. */
export function withAllow(overwrites, id, bits) {
  return upsert(overwrites, id, (allow, deny) => [allow | bits, deny & ~bits]);
}

function upsert(overwrites, id, apply) {
  const out = (overwrites ?? []).map((o) => ({ ...o }));
  const existing = out.find((o) => o.id === id);
  const [allow, deny] = apply(big(existing?.allow), big(existing?.deny));
  if (existing) {
    existing.allow = allow.toString();
    existing.deny = deny.toString();
    // Discord rejects an overwrite that neither allows nor denies anything.
    return out.filter((o) => big(o.allow) !== 0n || big(o.deny) !== 0n);
  }
  out.push({ id, type: ROLE, allow: allow.toString(), deny: deny.toString() });
  return out;
}
