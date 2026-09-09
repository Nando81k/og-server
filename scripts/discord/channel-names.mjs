/**
 * The server's channel tree and how each name is displayed.
 *
 * Kept apart from setup-server.mjs so it can be tested without a token: that
 * script runs main() on import, and importing it would sit there prompting.
 *
 * Every channel has a plain slug and a display name. The slug is the channel's
 * identity — topics are keyed by it, and the bot's lookups normalize the
 * decoration away — so the emoji here can change freely without breaking
 * anything that depends on a channel.
 */

export const TEXT = 0;
export const VOICE = 2;
export const FORUM = 15;

export const CATEGORY_EMOJI = {
  'START HERE': '📋',
  GENERAL: '💬',
  NYC: '🗽',
  GAMES: '🎮',
  ANIME: '📺',
  'SEASON + TOURNAMENTS': '🏆',
  FANTASY: '🐐',
  'AFTER HOURS': '🔞',
  MOD: '🛡️',
  OG: '🔒',
};

export const CHANNEL_EMOJI = {
  'welcome-rules': '📌',
  onboarding: '🚪',
  announcements: '📣',
  'general-chat': '💬',
  'sports-talk': '🏟️',
  'pop-culture': '🎬',
  'deep-thoughts': '🌙',
  highlights: '⭐',
  'General Voice': '🔊',
  'irl-plans': '📍',
  'bodega-tier-list': '🥪',
  'mta-complaints': '🚇',
  lfg: '🔎',
  '2k': '🏀',
  cod: '🎯',
  madden: '🏈',
  'fighting-games': '👊',
  '2K Voice': '🔊',
  'CoD Voice': '🔊',
  'Madden Voice': '🔊',
  'Fighting Games Voice': '🔊',
  anime: '🌸',
  'currently-watching': '📆',
  manga: '📖',
  recommendations: '🧭',
  gacha: '🎴',
  'Watch Party': '🔊',
  'season-leaderboard': '📊',
  pickem: '📝',
  brackets: '🗂️',
  'game-of-the-month': '🕹️',
  'nfl-fantasy-forum': '🏈',
  'nba-fantasy-forum': '🏀',
  standings: '📈',
  'trade-court': '⚖️',
  'Draft Night': '🔊',
  'smoke-lounge': '💨',
  'mod-chat': '🧰',
  'warn-log': '📕',
  'invite-tracking': '🔗',
  'og-chat': '🥇',
  'og-plans': '🗺️',
  'og-hall-of-fame': '🏛️',
  'OG Voice': '🔊',
};

/**
 * Categories keep their spaces and capitals, so a plain space reads fine.
 */
export function categoryDisplayName(plain) {
  const emoji = CATEGORY_EMOJI[plain];
  return emoji ? `${emoji} ${plain}` : plain;
}

/**
 * Discord lowercases a text channel name and turns spaces into hyphens, which
 * would make the separator look like part of the name. A heavy bar survives
 * intact. Voice channel names are left alone by Discord, so a space is fine.
 */
export function channelDisplayName(plain, type = TEXT) {
  const emoji = CHANNEL_EMOJI[plain];
  if (!emoji) return plain;
  return type === VOICE ? `${emoji} ${plain}` : `${emoji}┃${plain}`;
}

/** The tree itself. Permission overwrites are attached by the setup script. */
export const SERVER_PLAN = [
  { category: 'START HERE', channels: ['welcome-rules', 'onboarding', 'announcements'] },
  {
    category: 'GENERAL',
    channels: [
      'general-chat',
      'sports-talk',
      'pop-culture',
      'deep-thoughts',
      'highlights',
      { name: 'General Voice', type: VOICE },
    ],
  },
  { category: 'NYC', channels: ['irl-plans', 'bodega-tier-list', 'mta-complaints'] },
  {
    category: 'GAMES',
    channels: [
      'lfg',
      '2k',
      'cod',
      'madden',
      'fighting-games',
      // Standing rooms /lfg points people at, one per game.
      { name: '2K Voice', type: VOICE },
      { name: 'CoD Voice', type: VOICE },
      { name: 'Madden Voice', type: VOICE },
      { name: 'Fighting Games Voice', type: VOICE },
    ],
  },
  {
    category: 'ANIME',
    channels: [
      'anime',
      'currently-watching',
      'manga',
      'recommendations',
      'gacha',
      { name: 'Watch Party', type: VOICE },
    ],
  },
  {
    category: 'SEASON + TOURNAMENTS',
    channels: ['season-leaderboard', 'pickem', 'brackets', 'game-of-the-month'],
  },
  {
    category: 'FANTASY',
    channels: [
      { name: 'nfl-fantasy-forum', type: FORUM },
      { name: 'nba-fantasy-forum', type: FORUM },
      'standings',
      'trade-court',
      { name: 'Draft Night', type: VOICE },
    ],
  },
  { category: 'AFTER HOURS', channels: [{ name: 'smoke-lounge', nsfw: true }] },
  { category: 'MOD', channels: ['mod-chat', 'warn-log', 'invite-tracking'] },
  {
    category: 'OG',
    channels: ['og-chat', 'og-plans', 'og-hall-of-fame', { name: 'OG Voice', type: VOICE }],
  },
];

/** Every channel in the plan, flattened, with its slug and type resolved. */
export function planChannels() {
  return SERVER_PLAN.flatMap((section) =>
    section.channels.map((def) => ({
      category: section.category,
      name: typeof def === 'string' ? def : def.name,
      type: typeof def === 'string' ? TEXT : def.type ?? TEXT,
      nsfw: typeof def === 'string' ? false : !!def.nsfw,
    }))
  );
}
