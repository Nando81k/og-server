/**
 * Bots that belong in some channels and not others.
 *
 * Kept out of setup-server.mjs so it can be checked without a token: that
 * script runs main() on import, so anything defined inside it can only be
 * read by someone sitting at a password prompt.
 *
 * Two things about Discord's model make this less obvious than it looks:
 *
 *   1. Role permissions are a UNION of allows. Taking View Channel away from
 *      the bot's own role subtracts nothing while @everyone still grants it.
 *   2. Categories do not grant permissions to their channels at run time.
 *      Syncing COPIES overwrites down once; a channel that is not synced keeps
 *      its own set. Every channel here was created with its own list, so a deny
 *      placed on a category reaches none of them.
 *
 * So the deny lands on every channel individually, with an allow on the ones
 * the bot belongs in.
 *
 * Only bots that actually need confining belong here. Every bot is already
 * shut out of the MOD, OG and AFTER HOURS channels by those channels' own
 * overwrites — they deny @everyone View Channel and then name the roles that
 * get it back, and a bot's role is never among them. This list is about noise,
 * and about bots that read message content. It is not what keeps bots out of
 * the private rooms, so a bot that only needs to stay out of those — a music
 * bot, a lookup bot — does not belong here at all and needs no setup.
 *
 * Listing a bot that is not installed is harmless: no role, nothing to do. A
 * bot can be added here before it is invited and will land scoped on the first
 * run afterwards.
 */
import { VIEW_CHANNEL, SEND_MESSAGES } from './permissions.mjs';

export const BOT_SCOPES = [
  {
    // Card bots are fun in one room and a nuisance in forty. They also use
    // k!-style prefix commands rather than slash commands, which means they
    // read every message in every channel they can see — so this is a privacy
    // measure as much as a noise one.
    roles: ['Karuta', 'Mudae'],
    only: ['gacha'],
    bits: VIEW_CHANNEL | SEND_MESSAGES,
  },
];
