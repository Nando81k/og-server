/**
 * Practice drafts: the rules, and how they read in Discord.
 *
 * Nothing here touches the database, Discord or ESPN. Storage lives in db.mjs,
 * the player pool comes from fantasy.mjs, and the handlers in index.mjs wire
 * the three together. That split is what lets snake order, the bots and the
 * boards be tested without any of them.
 *
 * A draft is practice only. Nothing in it is ever sent to ESPN.
 */

import { grid, tidy } from './player.mjs';

export const DEFAULT_ROUNDS = 13;
export const MAX_ROUNDS = 20;
export const DEFAULT_CLOCK = 60;
export const MIN_CLOCK = 10;
export const MAX_CLOCK = 600;

/** How many players the pool holds: enough for the biggest draft plus slack. */
export const POOL_SIZE = 250;

/**
 * Most bot picks one run makes before handing back. A run is a single Discord
 * interaction or a single once-a-minute check, so an all-bot draft is worked
 * through over several of them rather than in one long request.
 */
export const MAX_BOT_PICKS_PER_RUN = 15;

/**
 * Where pick `pickNo` (1-based) falls in a snake draft over `seats` seats: odd
 * rounds run first seat to last, even rounds back again.
 */
export function slotFor(pickNo, seats) {
  const round = Math.floor((pickNo - 1) / seats) + 1;
  const i = (pickNo - 1) % seats;
  return { pickNo, round, inRound: i + 1, seatIndex: round % 2 === 1 ? i : seats - 1 - i };
}

export const totalPicks = (draft) => draft.rounds * draft.seats.length;

/** The seat on the clock for the draft's next pick, or null once it is over. */
export function seatOnClock(draft) {
  if (draft.status !== 'running' || draft.pickNo > totalPicks(draft)) return null;
  return draft.seats[slotFor(draft.pickNo, draft.seats.length).seatIndex];
}

/** The next few seats after the one on the clock, in order. */
export function upNext(draft, count = 3) {
  const out = [];
  for (let p = draft.pickNo + 1; out.length < count && p <= totalPicks(draft); p += 1) {
    out.push(draft.seats[slotFor(p, draft.seats.length).seatIndex]);
  }
  return out;
}

/** A seat's pick numbers from `from` on, e.g. for "your next pick is #27". */
export function picksForSeat(draft, seatIndex, from = 1) {
  const out = [];
  for (let p = Math.max(1, from); p <= totalPicks(draft); p += 1) {
    if (slotFor(p, draft.seats.length).seatIndex === seatIndex) out.push(p);
  }
  return out;
}

/** Fisher-Yates, with the randomness injectable so a test can pin the draw. */
export function shuffle(items, rand = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How likely a bot is to take each of the best five available players.
 * Mostly the top name by ADP, sometimes the next: enough variety that two
 * practice drafts are not the same draft, not so much that a bot reaches.
 */
export const BOT_WEIGHTS = [50, 25, 12, 8, 5];

export function botChoice(candidates, rand = Math.random) {
  const pool = candidates.slice(0, BOT_WEIGHTS.length);
  if (pool.length === 0) return null;
  const weights = BOT_WEIGHTS.slice(0, pool.length);
  let roll = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// On the live board nobody is a bot: a team with no linked person is simply a team.
const label = (seat, max = 14) => `${tidy(seat.name, max)}${seat.userId || seat.live ? '' : ' (bot)'}`;
const shortTeam = (seat) => tidy(seat.name, 12) + (seat.userId || seat.live ? '' : ' (b)');
const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

// ----------------------------------------------------------------- buttons

export const customId = (draftId, action, arg) => `dr:${draftId}:${action}${arg === undefined ? '' : `:${arg}`}`;

/** A draft button's id, or null for anything that isn't one. */
export function parseCustomId(id) {
  const m = /^dr:(\d+|live):(join|leave|begin|best|roster|board|round)(?::(\d+))?$/.exec(String(id ?? ''));
  return m ? { draftId: m[1] === 'live' ? 'live' : Number(m[1]), action: m[2], arg: m[3] === undefined ? null : Number(m[3]) } : null;
}

const button = (draftId, action, text, style = 2, arg) => ({
  type: 2, style, label: text, custom_id: customId(draftId, action, arg),
});

export const lobbyComponents = (id) => [{
  type: 1,
  components: [button(id, 'join', 'Join', 3), button(id, 'leave', 'Leave', 2), button(id, 'begin', 'Begin draft', 1)],
}];

export const boardComponents = (id, running) => [{
  type: 1,
  components: running
    ? [button(id, 'best', 'Draft best available', 3), button(id, 'roster', 'My roster'), button(id, 'board', 'Full board')]
    : [button(id, 'board', 'Full board')],
}];

/** The live board's buttons: look, never pick (the real draft happens in ESPN). */
export const liveComponents = () => [{
  type: 1,
  components: [button('live', 'roster', 'My roster'), button('live', 'board', 'Full board')],
}];

/** Round-to-round buttons for the full-board view. */
export function roundComponents(id, round, rounds) {
  return [{
    type: 1,
    components: [
      { ...button(id, 'round', 'Previous', 2, round - 1), disabled: round <= 1 },
      { ...button(id, 'round', `Round ${round}`, 1, round), disabled: true },
      { ...button(id, 'round', 'Next', 2, round + 1), disabled: round >= rounds },
    ],
  }];
}

// ------------------------------------------------------------------ embeds

const BLUE = 0x6b8afd;
const GREEN = 0x2f9e6a;
const AMBER = 0xd99a2b;
const GREY = 0x5b6270;

/** Who is in the lobby: every team, and who will draft it. */
export function lobbyEmbed(draft) {
  const rows = draft.seats.map((s, i) => [String(i + 1), tidy(s.name, 22), s.userId ? 'person' : 'bot']);
  const humans = draft.seats.filter((s) => s.userId).length;
  return {
    title: `Mock draft #${draft.id} lobby`,
    color: AMBER,
    description: [
      'Press **Join** to draft your team. Any team nobody joins is drafted by a bot.',
      'A mod presses **Begin draft** when everyone is in. The order is drawn at random.',
    ].join('\n'),
    fields: [
      {
        name: `Teams (${humans} of ${draft.seats.length} with a manager)`,
        value: ['```', ...grid(['#', 'Team', 'Drafted by'], rows, ['right', 'left', 'left']), '```'].join('\n'),
        inline: false,
      },
      {
        name: 'Managers',
        value: humans ? draft.seats.filter((s) => s.userId).map((s) => `<@${s.userId}> · ${tidy(s.name, 40)}`).join('\n') : 'Nobody yet.',
        inline: false,
      },
    ],
    footer: { text: `${draft.rounds} rounds, snake · ${draft.clockSeconds}s a pick · practice only, nothing touches ESPN` },
  };
}

/** The pinned board, edited after every pick. */
export function boardEmbed({ draft, recent, best }) {
  const total = totalPicks(draft);
  const fields = [];
  if (recent.length) {
    fields.push({
      name: 'Recent picks',
      value: ['```', ...grid(['#', 'Team', 'Player', 'Pos'], recent.map((p) => {
        const seat = draft.seats.find((s) => s.teamId === p.teamId);
        return [String(p.pickNo), seat ? shortTeam(seat) : '?', tidy(p.name, 16), p.position || '—'];
      }), ['right', 'left', 'left', 'left']), '```'].join('\n'),
      inline: false,
    });
  }

  const live = Boolean(draft.live);
  const name = live ? 'Live draft' : `Mock draft #${draft.id}`;
  if (draft.status === 'done' || draft.pickNo > total) {
    return {
      title: live ? 'The draft is done' : `Mock draft #${draft.id} is done`,
      color: GREEN,
      description: live
        ? `${draft.rounds} rounds, ${total} picks. Use **Full board** to look back at any round.`
        : `${draft.rounds} rounds, ${total} picks. Use **Full board** to look back, or a mod can run \`/draft start\` for another.`,
      fields,
      footer: { text: live ? 'Mirrored from ESPN.' : 'Practice only: nothing here touched ESPN.' },
    };
  }

  const slot = slotFor(draft.pickNo, draft.seats.length);
  const seat = draft.seats[slot.seatIndex];
  const lines = [
    `**On the clock:** ${seat.userId ? `<@${seat.userId}> · ` : ''}${label(seat, 30)}`,
    live
      ? `**Pick clock:** ${draft.clockSeconds ? `${draft.clockSeconds} seconds a pick` : 'see ESPN'} *(ESPN does not share the countdown)*`
      : draft.deadline && seat.userId
        ? `**Pick clock:** closes <t:${epoch(draft.deadline)}:R> *(${draft.clockSeconds} seconds a pick)*`
        : `**Pick clock:** a bot picks straight away`,
    `**Up next:** ${upNext(draft).map((s) => label(s, 16)).join(' · ') || 'nobody, this is the last pick'}`,
  ];
  if (best.length) {
    fields.push({
      name: 'Best available (by ESPN ADP)',
      value: ['```', ...grid(['#', 'Player', 'Pos', 'Team', 'ADP'], best.map((p, i) => [
        String(i + 1), tidy(p.name, 16), p.position || '—', p.proTeam || '—', p.adp.toFixed(1),
      ]), ['right', 'left', 'left', 'left', 'right']), '```'].join('\n'),
      inline: false,
    });
  }
  return {
    title: `${name} · Round ${slot.round} · Pick ${draft.pickNo} of ${total}`,
    color: BLUE,
    description: lines.join('\n'),
    fields,
    footer: { text: live ? 'Mirrored from ESPN about once a minute. Make your pick in ESPN.' : `Snake · ${draft.clockSeconds}s a pick · practice only, nothing touches ESPN` },
  };
}

/** One team's picks so far, and when it picks next. */
export function rosterEmbed({ draft, seatIndex, picks }) {
  const seat = draft.seats[seatIndex];
  const mine = picks.filter((p) => p.teamId === seat.teamId);
  const rows = mine.map((p) => [String(slotFor(p.pickNo, draft.seats.length).round), tidy(p.name, 16), p.position || '—', p.proTeam || '—', String(p.pickNo)]);
  const next = picksForSeat(draft, seatIndex, draft.pickNo).slice(0, 3);
  return {
    title: `Roster · ${tidy(seat.name, 60)}`,
    color: GREEN,
    description: mine.length ? undefined : 'No picks yet.',
    fields: [
      ...(mine.length
        ? [{ name: `${mine.length} pick${mine.length === 1 ? '' : 's'}`, value: ['```', ...grid(['Rd', 'Player', 'Pos', 'Team', 'Pick'], rows, ['right', 'left', 'left', 'left', 'right']), '```'].join('\n'), inline: false }]
        : []),
      { name: 'Next picks', value: next.length ? next.map((n) => `#${n}`).join(' · ') : 'None left.', inline: false },
    ],
    footer: draft.live ? undefined : { text: 'Positions are listed, not required: this is practice, so there are no roster rules to break.' },
  };
}

/** Every pick of one round, made or still to come. */
export function roundEmbed({ draft, picks, round }) {
  const n = draft.seats.length;
  const byNo = new Map(picks.map((p) => [p.pickNo, p]));
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const pickNo = (round - 1) * n + i + 1;
    const seat = draft.seats[slotFor(pickNo, n).seatIndex];
    const p = byNo.get(pickNo);
    const onClock = draft.status === 'running' && pickNo === draft.pickNo;
    rows.push([String(pickNo), shortTeam(seat), p ? tidy(p.name, 16) : onClock ? 'on the clock' : '', p ? p.position || '—' : '']);
  }
  return {
    title: `Round ${round} of ${draft.rounds}`,
    color: BLUE,
    description: round % 2 === 0 ? 'Snake: this round runs in reverse.' : undefined,
    fields: [{ name: 'Picks', value: ['```', ...grid(['#', 'Team', 'Player', 'Pos'], rows, ['right', 'left', 'left', 'left']), '```'].join('\n'), inline: false }],
  };
}

/**
 * Before the real draft starts: when it is, and the order teams will pick in.
 * `date` is epoch ms or null.
 */
export function liveOrderEmbed({ draft, date }) {
  const rows = draft.seats.map((s, i) => [String(i + 1), tidy(s.name, 22), s.userId ? 'linked' : '—']);
  return {
    title: 'The draft has not started',
    color: AMBER,
    description: [
      date ? `Scheduled for <t:${Math.floor(date / 1000)}:F> (<t:${Math.floor(date / 1000)}:R>).` : 'ESPN has not set a time yet.',
      'This message updates by itself once picks start.',
    ].join('\n'),
    fields: [{
      name: draft.seats.length ? `Pick order (${draft.rounds} rounds, ${draft.seats.length} teams)` : 'Pick order',
      value: draft.seats.length
        ? ['```', ...grid(['#', 'Team', 'On Discord'], rows, ['right', 'left', 'left']), '```'].join('\n')
        : 'ESPN has not set the order yet.',
      inline: false,
    }],
    footer: { text: 'Mirrored from ESPN about once a minute. Link your team with /fantasy link to be pinged on your pick.' },
  };
}

/** The line announcing a pick. */
export function pickLine(pick, seat) {
  const who = seat ? label(seat, 40) : 'A team';
  const what = `${tidy(pick.name, 40)}${pick.position || pick.proTeam ? ` (${[pick.position, pick.proTeam].filter(Boolean).join(', ')})` : ''}`;
  if (pick.auto && seat?.live) return `Pick ${pick.pickNo}: ${who} was auto-drafted ${what}`;
  if (pick.auto && seat?.userId) return `Pick ${pick.pickNo}: ${who} ran out of time, so the bot picked ${what}`;
  return `Pick ${pick.pickNo}: ${who} drafted ${what}`;
}

/** The line telling a person it is their turn. */
export const clockLine = (draft, seat) =>
  `<@${seat.userId}>, you're on the clock for pick ${draft.pickNo}.${draft.live ? (draft.clockSeconds ? ` You have ${draft.clockSeconds} seconds in ESPN.` : '') : ` You have ${draft.clockSeconds} seconds.`}`;

/**
 * Check a pick before making it. `player` is the pool entry or null; `userId`
 * the person trying. Returns { ok: true } or { ok: false, error }.
 */
export function validatePick({ draft, userId, player, taken }) {
  const bad = (error) => ({ ok: false, error });
  if (draft.status !== 'running') return bad(draft.status === 'lobby' ? 'The draft has not begun yet.' : 'That draft is over.');
  const seat = seatOnClock(draft);
  if (!seat) return bad('That draft is over.');
  if (!seat.userId) return bad(`It is ${tidy(seat.name, 30)}'s turn, and a bot picks for them.`);
  if (seat.userId !== userId) return bad(`It is not your turn: ${tidy(seat.name, 30)} is on the clock.`);
  if (!player) return bad('That player is not in this draft. Pick from the list as you type.');
  if (taken) return bad(`${tidy(player.name, 40)} has already been drafted.`);
  return { ok: true };
}
