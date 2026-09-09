/**
 * The "what is this channel for" post that sits pinned at the top of each
 * channel. A topic explains a channel in one line; this explains how to use it.
 *
 * Keyed by the plain slug, not the decorated name, so renaming a channel in
 * Discord never orphans its guide. `{#slug}` is replaced with a real channel
 * mention at post time — see renderGuide — so the links stay live through
 * renames too.
 *
 * Eight channels are missing on purpose: welcome-rules, lfg, bodega-tier-list,
 * pickem, game-of-the-month, trade-court, og-hall-of-fame and
 * season-leaderboard already have a pinned post. The seeder skips any channel
 * whose pin was written by a person.
 */
export const GUIDES = {
  onboarding: `**pick your stuff**

Answer the questions and you get your game roles, your borough, and the channels that come with them. Takes about ten seconds.

Change your mind whenever — the roles are self-serve and nothing here is permanent.

If a channel looks missing, it's because you haven't picked the role that opens it.`,

  announcements: `**server news, rarely**

Anything that changes how this place works lands here — tournaments, rule changes, dates worth putting in your phone.

Kept quiet on purpose. If this channel pings you, it's worth reading.`,

  'general-chat': `**the main room**

No topic. Say whatever. This is the default for anything that doesn't have its own channel yet.

If a conversation takes the room over — a game, a show, a plan — there's probably a channel for it. Move it there and this stays usable for everyone else.`,

  'sports-talk': `**local suffering, mostly**

Knicks, Nets, Yankees, Mets, Jets, Giants. Trades, injuries, and whatever happened last night.

League drama has its own home in {#nfl-fantasy-forum} and {#nba-fantasy-forum} — keep it there so this channel stays about actual games.`,

  'pop-culture': `**music, shows, movies**

Whatever's playing. Drop the link and say why it's worth the time.

Anime has its own category so it doesn't drown everything else out — start at {#anime}.

Spoiler-tag anything that just came out, ||like this||.`,

  'deep-thoughts': `**the 3am channel**

Life, work, money, people. No sports and no games — that separation is the whole reason this channel exists.

Nobody's obligated to have a take. Sometimes people just need to say the thing out loud.

What gets said here doesn't get repeated in {#general-chat}.`,

  highlights: `**the best of this place**

React with ⭐ to anything worth keeping — a clip, a take, a screenshot, someone getting cooked. Three stars and Carl-bot copies it here on its own.

You don't post here. You nominate by reacting, wherever you already are.

This is also the one channel that gets screenshotted outside the server, so it's what strangers judge us by.`,

  'irl-plans': `**actually linking up**

Say what, where, and when. Put your borough in it — half the reason plans die is nobody knows who's close.

For anything with a date, use Sesh: \`/create\` makes an event people can hit yes or no on, so you know who's actually coming before you leave the house.

"we should link up sometime" has never once worked. Pick a day.`,

  'mta-complaints': `**therapy**

Delays, reroutes, the guy with the speaker, the smell. Get it out here so it stops leaking into every other channel.

Photos encouraged. Nobody believes you otherwise.`,

  '2k': `**park, myteam, and badge arguments**

Builds, clips, and whoever's been ducking. Run {#lfg} when you want a squad — it pings everyone with the 2K role and points at the voice room.

Post an L as readily as a W. It's funnier, and everyone knows anyway.`,

  cod: `**loadouts and lobby blame**

Class setups, clips, and whatever the meta is this week.

{#lfg} pings the CoD role and links the voice room. Use it — nobody's reading this channel at 1am, but a ping lands.`,

  madden: `**franchise and CPU conspiracy theories**

Franchise saves, Ultimate Team, sliders, and the fourth-quarter comeback the CPU always gets.

Looking for a game? {#lfg} pings the Madden role.

Fantasy football is a separate thing and lives in {#nfl-fantasy-forum}.`,

  'fighting-games': `**sets, frame data, getting bodied**

Any game — traditional fighters, platform fighters, whatever's in rotation. Post your main and catch strays.

{#lfg} pings the FGC role and points at the voice room. First to five, loser counterpicks, nobody rage quits.`,

  anime: `**the main anime room**

Airing, finished, obscure, all of it. This season's shows have {#currently-watching} and "what should I watch" has {#recommendations} — this is for everything else.

Spoiler rule: if it aired this week, tag it ||like this||. Older than a season is fair game, but read the room.`,

  'currently-watching': `**this season, week by week**

What you're keeping up with as it airs. Episode reactions belong here so {#anime} doesn't turn into a minefield.

Name the show and episode before you say anything — **AOT ep 7** — then your take. Anything past that gets bars, ||like this||.`,

  manga: `**assume everyone here is ahead**

Manga, manhwa, manhua. This is the one room where being ahead of the anime is the default, so if you're watching and not reading, tread carefully.

Still tag the last couple of chapters. Being ahead isn't a licence to ruin it.`,

  recommendations: `**what to watch next**

Say what it is, and say why. "watch X" is useless. "watch X if you liked Y" is what people actually act on.

Asking counts too — name a couple of things you liked and the room will do the rest.`,

  gacha: `**card bots live here**

Summons, pulls, trades, and whatever bot minigame is running. Penned in one room so it doesn't fill every other channel with card spam.

Post your pulls. Nobody wants to see them. Post them anyway.`,

  brackets: `**tournaments run here**

Seeding, matchups and results for 2K and fighting game tourneys. The bracket gets pinned whenever one is live.

Report your set the moment it's done — a whole bracket stalls on one unreported match.

Placements feed the season leaderboard in {#season-leaderboard}.`,

  standings: `**both leagues, one place**

Nothing here yet. This fills in once the Sleeper and ESPN leagues actually exist.

The plan: one command pulls both leagues into a single board, and a weekly recap posts here with scores, the biggest blowout, and the worst bench decision of the week.`,

  'smoke-lounge': `**18+ only**

You needed the 18+ role to see this, which means you said you were of age. Don't make that a lie.

Slow channel. Nothing said here goes anywhere else.

No sourcing, and nothing that would get the server reported. Use sense.`,

  'mod-chat': `**mods only**

Anything about a member, a report, or a call that needs a second opinion before it happens.

Decisions get made here and then explained wherever they land. Nobody should be moderated without knowing why.`,

  'warn-log': `**written automatically — don't post here**

Carl-bot logs deletes, edits, purges, joins and leaves, role changes, nickname and avatar changes, bans, unbans and timeouts into this channel, plus anything automod catches.

Read it, don't type in it. A human message in here makes the log harder to scan on the day it actually matters.`,

  'invite-tracking': `**who brought whom**

Empty until invite tracking is switched on. After that, every join lands here with the invite that brought them.

Worth having before the server opens up rather than after — if someone is inviting people who cause problems, this is the only way to see the pattern.`,

  'og-chat': `**the group chat, continued**

Same people, same conversations, none of the audience. If it would have gone in the group chat, it goes here.

OG isn't earnable and never will be — {#welcome-rules} says why. Nobody in here owes anyone an explanation of that.`,

  'og-plans': `**before it's a server thing**

Ideas, events and decisions while they're still half-formed. Once something's real it moves to {#announcements} and belongs to everybody.

Also where you get to say "should we even do this" without it becoming a whole debate.`,
};

/** Channels whose pinned post was written by hand and must not be touched. */
export const ALREADY_PINNED = [
  'welcome-rules',
  'lfg',
  'bodega-tier-list',
  'pickem',
  'game-of-the-month',
  'trade-court',
  'og-hall-of-fame',
  'season-leaderboard',
];

/** Every `{#slug}` a guide refers to. */
export function referencedSlugs(text) {
  return [...String(text).matchAll(/\{#([a-z0-9-]+)\}/g)].map((m) => m[1]);
}

/**
 * Swap `{#slug}` for a real channel mention. A slug with no channel falls back
 * to plain `#slug` text rather than leaving braces in a pinned post.
 */
export function renderGuide(text, idBySlug) {
  return String(text).replace(/\{#([a-z0-9-]+)\}/g, (_, slug) => {
    const id = idBySlug instanceof Map ? idBySlug.get(slug) : idBySlug?.[slug];
    return id ? `<#${id}>` : `#${slug}`;
  });
}
