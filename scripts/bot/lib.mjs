/**
 * Decisions the bot makes, kept free of discord.js so they can be tested
 * without a token or a live server.
 */

/** Slash-command choice -> the role the setup script created. */
export const GAME_ROLES = {
  '2k': '2K',
  cod: 'CoD',
  madden: 'Madden',
  fgc: 'Fighting Games',
};

/** Marks a voice channel as ours, so orphans can be swept after a restart. */
export const TEMP_PREFIX = 'LFG · ';

export function tempChannelName(game) {
  const role = GAME_ROLES[game];
  if (!role) throw new Error(`unknown game: ${game}`);
  return `${TEMP_PREFIX}${role}`;
}

export function isTempChannel(name) {
  return typeof name === 'string' && name.startsWith(TEMP_PREFIX);
}

/**
 * A temp channel is disposable once it is empty — either because everyone
 * left, or because nobody ever arrived and the grace period has passed.
 */
export function shouldDelete({ memberCount, createdAt, now, graceMs }) {
  if (memberCount > 0) return false;
  return now - createdAt >= graceMs;
}

/** New Member becomes Member once they have been around long enough. */
export function isDueForPromotion({ joinedAt, now, afterDays }) {
  if (!joinedAt) return false; // Discord occasionally omits it; never guess
  return now - joinedAt >= afterDays * 24 * 60 * 60 * 1000;
}

/**
 * Discord rejects a user limit outside 1-99, and 0 means unlimited, which is
 * never what someone asking for a squad size wants.
 */
export function clampSlots(slots) {
  const n = Number(slots);
  if (!Number.isFinite(n)) return 5;
  return Math.min(99, Math.max(2, Math.round(n)));
}
