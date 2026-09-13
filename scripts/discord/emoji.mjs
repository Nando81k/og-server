/**
 * Turning image files into Discord emoji names, and checking they will be
 * accepted before anything is uploaded.
 *
 * Kept apart from the upload script so it can be tested without a token.
 *
 * Discord's rules, which it enforces with unhelpful 400s:
 *   - name is 2-32 characters, letters, digits and underscores only
 *   - the image is at most 256 KB
 *   - PNG, JPEG, GIF or WebP
 * An animated GIF takes a slot from a separate, smaller pool than static
 * emoji, so a server can have room for one and not the other.
 */

/** 256 KB, Discord's hard limit on an emoji image. */
export const MAX_BYTES = 256 * 1024;

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** The file extensions worth trying to upload. */
export const EXTENSIONS = Object.keys(TYPES);

export function mimeFor(filename) {
  const ext = String(filename ?? '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return TYPES[ext] ?? null;
}

/**
 * The emoji name a file will get: its filename, minus extension, reduced to
 * what Discord accepts.
 *
 *   "Big W.png"      -> "big_w"
 *   "no-cap!!.gif"   -> "no_cap"
 *
 * Returns null when nothing usable survives, so a file named "!!!.png" is
 * reported rather than uploaded under a name nobody chose.
 */
export function emojiName(filename) {
  const base = String(filename ?? '').replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (cleaned.length < 2 || cleaned.length > 32) return null;
  return cleaned;
}

/**
 * Why a file cannot be uploaded, or null if it can.
 *
 * Checked before any upload starts. Discord rejects an oversized image with a
 * 400 that does not say which file, and a run that fails halfway leaves a
 * server half-populated.
 */
export function rejectReason({ filename, bytes }) {
  if (!mimeFor(filename)) return `not an image Discord accepts (${EXTENSIONS.join(', ')})`;
  if (!(bytes > 0)) return 'the file is empty';
  if (bytes > MAX_BYTES) {
    return `${(bytes / 1024).toFixed(0)} KB, over Discord's ${MAX_BYTES / 1024} KB limit`;
  }
  if (!emojiName(filename)) {
    return 'the name has no letters or digits Discord would accept';
  }
  return null;
}

/** Animated emoji come from a separate, smaller pool of slots. */
export function isAnimated(filename) {
  return mimeFor(filename) === 'image/gif';
}
