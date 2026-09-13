/**
 * The two public Discord identifiers for this server and bot.
 *
 * Neither is a secret. The guild id is in every channel link, and the
 * application id is in the bot's invite URL and visible to anyone who can see
 * the bot in a member list — Discord treats it as public and so should we.
 * The bot *token* is the secret, and it is never in this repo: every script
 * prompts for it, hidden, and none of them accept it as an argument.
 *
 * These live here so the scripts stop asking for them. Retyping an eighteen
 * digit number from the Developer Portal before every command registration is
 * how a command ends up registered against the wrong application, which fails
 * silently — the API returns 200 and the commands appear in a server nobody is
 * looking at.
 *
 * Every script still reads its environment variable first, so pointing one at
 * a different server or a test bot is a prefix away:
 *
 *   GUILD_ID=... npm run seed
 */

/** The OGs Server. Also set as GUILD_ID in worker/wrangler.toml. */
export const GUILD_ID = '1546707076460445787';

/** OG Bot, from the Developer Portal's General Information page. */
export const APPLICATION_ID = '1546707619857702962';
