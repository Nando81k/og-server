/**
 * The "what is this channel for" post that sits pinned at the top of each
 * channel. A topic explains a channel in one line; this explains how to use it.
 *
 * Keyed by the plain slug, not the decorated name, so renaming a channel in
 * Discord never orphans its guide. `{#slug}` is replaced with a real channel
 * mention at post time — see renderGuide — so the links stay live through
 * renames too.
 *
 * Seven channels are missing on purpose: welcome-rules, lfg, bodega-tier-list,
 * pickem, trade-court, og-hall-of-fame and season-leaderboard already have a
 * pinned post. The seeder skips any channel
 * whose pin was written by a person.
 */
export const GUIDES = {
  onboarding: `**pick your stuff**

Answer the questions and you get your game roles, your borough, and the channels that come with them. Takes about ten seconds.

Change your mind whenever — the roles are self-serve and nothing here is permanent.

If a channel looks missing, it just means you haven't picked the role that opens it yet. Grab the role and it shows up.`,

  announcements: `**server news, rarely**

Anything that changes how this place works lands here — tournaments, rule changes, dates worth putting in your phone.

Kept quiet on purpose. If this channel pings you, it's worth a read.`,

  'general-chat': `**the main room**

No topic. Say whatever. This is the default for anything that doesn't have its own channel yet.

New here? This is the easiest place to start. Say hi whenever you're ready — nobody's going to make it weird.

If a conversation really takes off — a game, a show, a plan — there's probably a channel built for it. Moving it over gives it more room and keeps this one easy to drop into.`,

  'sports-talk': `**NY teams, mostly**

Knicks, Nets, Yankees, Mets, Jets, Giants. Trades, injuries, and whatever happened last night.

Not a New York fan? Bring your team in anyway. More fun with someone to disagree with.

Fantasy league business has its own home in {#nfl-fantasy-forum} and {#nba-fantasy-forum} — keeping it there leaves this channel for the actual games.`,

  'pop-culture': `**music, shows, movies**

Whatever's playing. Drop the link and say why it's worth the time — that second part is what gets people to actually press play.

Anime has its own whole category so it doesn't crowd everything else out — start at {#anime}.

Spoiler-tag anything that just came out, ||like this||.`,

  'deep-thoughts': `**the late-night channel**

Life, work, money, people. No sports and no games — that separation is the whole reason this channel exists.

Nobody's obligated to have a take, and nobody's obligated to fix anything. Sometimes it's enough to say the thing out loud and have someone hear it.

What gets said here stays here. It doesn't get repeated in {#general-chat}.`,

  highlights: `**the best of this place**

React with ⭐ to anything worth keeping — a clip, a great take, a screenshot, a moment that made you laugh. Three stars and Carl-bot copies it here on its own.

You don't post here. You nominate by reacting, wherever you already are.

This is also the channel most likely to get shared outside the server, which makes it a pretty good showcase of what this place actually is.`,

  'irl-plans': `**actually linking up**

Say what, where, and when. Adding your borough helps more than you'd think — a lot of plans stall out because nobody knows who's close.

For anything with a date, use Sesh: \`/create\` makes an event people can hit yes or no on, so you know who's coming before you head out.

"We should link up sometime" is a lovely thought that rarely survives contact with a calendar. Picking an actual day is most of the work.`,

  'mta-complaints': `**vent here, we've all been there**

Delays, reroutes, the guy with the speaker, the mystery puddle. Get it out here and it stops leaking into every other channel.

Photos encouraged. Half the fun is the evidence.

Also a good place to ask "is the L actually running" before you commit to a plan.`,

  '2k': `**park, myteam, and badge arguments**

Builds, clips, and whoever's on tonight. Run {#lfg} when you want a squad — it pings everyone with the 2K role and points at the voice room.

Post an L as readily as a W. The bad ones make better clips anyway.

All skill levels welcome here. Nobody started good.`,

  cod: `**loadouts and lobbies**

Class setups, clips, and whatever the meta is this week.

{#lfg} pings the CoD role and links the voice room. Use it — a ping lands a lot better than a message in here at 1am.

Ask if you want help tuning a class. Somebody always has opinions.`,

  madden: `**franchise and CPU conspiracy theories**

Franchise saves, Ultimate Team, sliders, and the fourth-quarter comeback the CPU always seems to find.

Looking for a game? {#lfg} pings the Madden role.

Fantasy football is a separate thing and lives in {#nfl-fantasy-forum}.`,

  'fighting-games': `**sets, frame data, and getting better**

Any game — traditional fighters, platform fighters, whatever's in rotation. Post your main, ask about a matchup, or just come get some games in.

{#lfg} pings the FGC role and points at the voice room. First to five, loser counterpicks.

New to fighting games? Say so. Plenty of people here are happy to slow it down and actually explain what hit you.`,

  anime: `**the main anime room**

Airing, finished, obscure, all of it. This season's shows have {#currently-watching} and "what should I watch" has {#recommendations} — this is for everything else.

Spoiler rule: if it aired this week, tag it ||like this||. Older than a season is usually fair game, but if it's a big moment, tag it anyway. Costs you nothing.`,

  'currently-watching': `**this season, week by week**

What you're keeping up with as it airs. Episode reactions belong here so {#anime} stays safe to scroll.

Name the show and episode before you say anything — **AOT ep 7** — then your take. Anything past that gets bars, ||like this||.

**Running a watch party.** Say what and when here and ping @Watch Party — it's self-assignable, so anyone who wants in already has it. For anything more than an hour out, use Sesh: \`/create\` makes an event people can RSVP to, so you know who's turning up.

Everyone piles into {#watch-party}. One person plays the episode and hits **Go Live** on their browser window — only the host needs a subscription, everyone else just watches.

**If Go Live shows a black screen**, that's DRM, and it's fixable. Share the *window*, not the whole screen — that alone usually does it. Still black: turn off hardware acceleration in your browser settings. Firefox handles this best of the three.

Streams cap at 720p without Nitro. Fine for watching together, so maybe not the episode you've been saving all season.`,

  manga: `**readers are usually ahead in here**

Manga, manhwa, manhua. This is the one room where being ahead of the anime is normal, so if you're anime-only, scroll with a little care.

Tag the last couple of chapters anyway. Being ahead isn't a reason to take the moment away from someone.`,

  recommendations: `**what to watch next**

Say what it is, and say why. "Watch X if you liked Y" gives people something to go on, and it's the kind that actually gets watched.

Asking counts too — name a couple of things you liked and the room will take it from there.

No guilty pleasures in here. Recommend the thing.`,

  gacha: `**card bots live here**

Karuta drops anime cards in this channel and you collect them. It's free, there's no account, and there's nothing to install — you play it by typing in here.

**How it actually works**

Cards come out three at a time, either when somebody runs \`k!drop\` or on their own when this channel is busy. Under the drop you'll see 1️⃣ 2️⃣ 3️⃣ — tap the number of the one you want. Fastest tap gets it.

That's the whole game. Everything below is optional.

**Your first five minutes**

— \`k!verify\` once, before anything else — Karuta asks everyone to do this before their first drop, and sends you a quick puzzle to prove you're a person
— \`k!drop\` puts three cards up for grabs (30 minute cooldown)
— Tap a number on anyone's drop to claim a card, not just your own
— \`k!collection\` shows what you own
— \`k!view <code>\` shows one card up close
— \`k!daily\` is free currency, once a day

**What makes a card good**

The **print number** (#123) is how many of that card exist — lower is rarer, and anything under #100 is a genuinely big deal. **Quality** runs 0 to 4 stars, 4 being Mint. The same character also comes in different **editions** with different art.

**Once you're in deeper**

\`k!burn <code>\` turns a card you don't want into gold and dust. \`k!work\` puts your cards on jobs so they earn while you're away. \`k!trade @someone\` swaps anything with anyone. \`k!cd\` shows your cooldowns, \`k!balance\` your money, and \`k!help\` lists the rest.

**One thing worth knowing early:** grabbing puts you on a cooldown too, so it's usually worth waiting for a card you actually want instead of taking the first one you see.

No pressure to min-max any of it — most people here just grab characters they like. Post your pulls, the great ones and the disasters. The disasters get more reactions.`,

  brackets: `**tournaments run here**

Seeding, matchups and results for 2K and fighting game tourneys. OG Bot runs the bracket — no site to sign up on and no link to lose.

**Running one**

— A mod opens it with \`/bracket create\`
— Everybody runs \`/bracket join\`
— A mod runs \`/bracket start\`, which draws it
— \`/bracket view\` any time to see who you play next

**Report your set when it ends.** \`/bracket report\` — start typing a name and it offers the sets waiting on a result, so there's no match number to remember. Either player can report it, and so can a mod. Everyone behind you in the bracket is waiting on that result, so it's worth doing right away.

Reported it wrong? A mod runs \`/bracket undo\` and it goes back. That works right up until the grand final — once that lands the tournament closes and points go out, and a fix after that is \`/award\`.

**The format, so nobody has to wonder mid-tournament.**

Double elimination. You have to lose twice to be out, because one rough matchup in round one shouldn't end your whole night.

Sets are best of 3 until winners and losers finals, then best of 5.

Grand finals reset: if the player coming out of losers wins the first set, you play a second one to decide it. They had to lose twice to get there; the other player hasn't lost yet.

The draw is random — not by skill, not by who signed up first. Keeps it simple and nobody has to defend a seeding.

**What a placing is worth**, paid out the moment the bracket ends:

— Win it: 50
— Runner up: 30
— 3rd: 20 · 4th: 12
— Top 8: 6 · Entered: 2

Everybody who enters scores. They land in {#season-leaderboard} on their own.

**Game of the month runs here too.** Nominate a game, react to vote, and the winner is what everybody's playing next month. Nominations open the last week of the month, one each, and the winner gets a pinned thread.`,
  standings: `**both leagues, one place**

Nothing here yet. This fills in once the Sleeper and ESPN leagues actually exist.

The plan: one command pulls both leagues into a single board, and a weekly recap posts here with scores, the biggest blowout, and the bench decision somebody's going to be hearing about all week.`,

  'smoke-lounge': `**18+ only**

You needed the 18+ role to get in here, which means you told us you're of age. We're taking your word for it.

Slow channel. Nothing said here goes anywhere else.

No sourcing, and nothing that would put the server at risk. Use your judgment.`,

  'mod-chat': `**mods only**

Anything about a member, a report, or a call that could use a second opinion before it happens.

Decisions get made here and then explained wherever they land. Nobody should be moderated without knowing why.`,

  'warn-log': `**written automatically — no need to post here**

Carl-bot logs deletes, edits, purges, joins and leaves, role changes, nickname and avatar changes, bans, unbans and timeouts into this channel, plus anything automod catches.

Voice events are switched off on purpose — with eight standing voice rooms they'd bury everything else.

It's a record, not a scoreboard. Most of what lands here is somebody changing their avatar.`,

  'invite-tracking': `**who brought whom**

Empty until invite tracking is switched on. After that, every join lands here with the invite that brought them.

Mostly nice for seeing who keeps bringing good people in — and useful for spotting a pattern early if one ever needs spotting.`,

  'og-chat': `**the group chat, continued**

Same people, same conversations, none of the audience. If it would have gone in the group chat, it goes here.

OG just means you were around before the server went public — a timestamp, not a rank. {#welcome-rules} has the long version.`,

  'og-plans': `**before it's a server thing**

Ideas, events and decisions while they're still half-formed. Once something's real it moves to {#announcements} and belongs to everybody.

Also the place to say "should we even do this" without it turning into a whole thing.`,
};

/**
 * Forum channels can't hold a pinned message the way a text channel can, but
 * Discord shows their Guidelines at the top when you open one — the same job.
 * Guidelines are the channel's `topic`, which allows 4096 characters on a forum
 * against 1024 on a text channel, so these can be fuller than a topic line.
 */
export const FORUM_GUIDELINES = {
  'nfl-fantasy-forum': `**NFL fantasy — one thread per thing**

This is a forum, not a chat. Every trade, waiver claim, injury scare and grievance gets its own post, so a Tuesday argument doesn't bury a Thursday one.

**Naming a post**
Put the actual subject in the title. "Trade: my Kamara for your Hall" beats "thoughts?" — people scan titles, which is the whole point of a forum.

**What goes where**
— Proposed trades go to {#trade-court} first, where the server votes fair / collusion / robbery over 24 hours
— Standings and the weekly recap live in {#standings}
— NFL talk that isn't about our league belongs in {#sports-talk}

**House rules**
Collusion gets a trade reversed — that's a call, not a debate. Set your lineup when you can; a team that checks out takes the fun out of someone else's week too. Last place wears the punishment role until the next draft, and wears it proudly.

Talk your trash and keep it about the football. If someone's new to fantasy, help them out — a league where everyone knows what they're doing is a better league.`,

  'nba-fantasy-forum': `**NBA fantasy — one thread per thing**

Same shape as the NFL forum: one post per trade, waiver, or complaint, titled so people can tell whether to open it. "Trade: Sengun for Giddey" tells them. "yo" does not.

**What's different here**
Basketball is a games-played game. Streaming, rest days and back-to-backs decide more weeks than talent does, so schedule talk is on-topic in a way it never is in football.

**What goes where**
— Proposed trades go to {#trade-court} for the same 24 hour vote
— Standings and the weekly recap live in {#standings}
— Knicks and Nets talk belongs in {#sports-talk}

Punishment role for last place applies here too. Set your lineup — and ask if you're not sure about streaming, it's genuinely confusing your first season and everyone here learned it from someone.`,
};

/**
 * Tags turn a forum from a flat list into something filterable. Both leagues
 * share the four things a fantasy post is ever actually about, plus a draft
 * tag, and then one each for what differs: football argues about start/sit,
 * basketball argues about streaming the schedule.
 *
 * None are moderated — in a server this size, making people ask a mod to tag
 * their own post would just mean nobody tags anything.
 */
export const FORUM_TAGS = {
  'nfl-fantasy-forum': [
    { name: 'Trade', emoji: '🤝' },
    { name: 'Waiver', emoji: '📝' },
    { name: 'Injury', emoji: '🏥' },
    { name: 'Start/Sit', emoji: '🤔' },
    { name: 'Grievance', emoji: '😤' },
    { name: 'Draft', emoji: '🎯' },
  ],
  'nba-fantasy-forum': [
    { name: 'Trade', emoji: '🤝' },
    { name: 'Waiver', emoji: '📝' },
    { name: 'Injury', emoji: '🏥' },
    { name: 'Streaming', emoji: '🔄' },
    { name: 'Grievance', emoji: '😤' },
    { name: 'Draft', emoji: '🎯' },
  ],
};

/** Channels whose pinned post was written by hand and must not be touched. */
export const ALREADY_PINNED = [
  'welcome-rules',
  'lfg',
  'bodega-tier-list',
  'pickem',
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

/**
 * Whether a channel's stored guidelines already match what we would write.
 *
 * Compared loosely on purpose. A topic differing only in line endings or
 * trailing whitespace is the same guidelines as far as a reader is concerned,
 * and rewriting it every run spends an API call to change nothing. A missing
 * topic reads as empty rather than throwing.
 */
export function sameTopic(current, wanted) {
  const tidy = (t) => String(t ?? '').replace(/\r\n/g, '\n').trim();
  return tidy(current) === tidy(wanted);
}

/**
 * Index of the first character where two topics diverge, or -1 if they match.
 *
 * Only used to explain a write in the log. Both forums were being rewritten on
 * every run, and finding out why meant guessing, because the script said what
 * it did but never what it saw. This says whether the stored copy is missing,
 * truncated, or altered — and where — without needing a token to investigate.
 */
export function firstDifference(current, wanted) {
  const a = String(current ?? '');
  const b = String(wanted ?? '');
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : shared;
}
