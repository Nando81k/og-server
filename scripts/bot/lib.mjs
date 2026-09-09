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

/**
 * The permanent voice room per game. Discord's REST API exposes one user's
 * voice state but never a list, so nothing without a live gateway connection
 * can tell whether a room has emptied out. Standing rooms sidestep that
 * entirely: nothing to create, nothing to clean up, and no way to disconnect
 * a live session by deleting a channel underneath it.
 */
export const GAME_VOICE = {
  '2k': '2K Voice',
  cod: 'CoD Voice',
  madden: 'Madden Voice',
  fgc: 'Fighting Games Voice',
};

export function voiceRoomFor(game) {
  const name = GAME_VOICE[game];
  if (!name) throw new Error(`unknown game: ${game}`);
  return name;
}

/**
 * Channel names carry decoration — emoji, separator bars, capitals — and that
 * decoration changes whenever someone tidies the server. Comparing normalized
 * names means "🔊 2K Voice" and "2K Voice" are the same room, so renaming a
 * channel can never quietly break the /lfg jump link again.
 */
export function normalizeChannelName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when a Discord channel is the room we mean, decoration aside. */
export function isChannelNamed(channel, wanted) {
  return normalizeChannelName(channel?.name) === normalizeChannelName(wanted);
}

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
