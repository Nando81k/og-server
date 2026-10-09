/**
 * Fantasy trade proposals: the rules, and how they read in Discord.
 *
 * Nothing here touches the database, Discord or ESPN. Storage lives in db.mjs,
 * rosters come from fantasy.mjs, and the handlers in index.mjs wire the three
 * together. That split is what lets the voting rules be tested without any of
 * them.
 *
 * The bot only reports. It cannot make, block or undo a trade in ESPN, so a
 * "veto" here means the server and its mods say it shouldn't stand, and the
 * managers (or the commissioner, in ESPN) act on that.
 */

export const VOTES = ['fair', 'collusion', 'robbery'];

/** Fewest votes that count as the server having spoken. */
export const QUORUM = 3;

/** Hours a proposal stays open for votes, unless TRADE_VOTE_HOURS says otherwise. */
export const DEFAULT_VOTE_HOURS = 24;

/** Most players per side, the number of player options /trade propose offers. */
export const MAX_PER_SIDE = 3;

export const MAX_NOTE = 200;

const LABEL = { fair: 'Fair', collusion: 'Collusion', robbery: 'Robbery' };

export const voteLabel = (v) => LABEL[v] ?? v;

/** Statuses a trade can still move out of. Mirrors LIVE_TRADE_STATUSES in db.mjs. */
export const LIVE = ['open', 'approved', 'flagged', 'no_quorum'];

/**
 * Count the votes, ignoring anyone who is not allowed one.
 *
 * `excluded` is the two managers. They are refused at vote time already, but a
 * link made or changed afterwards could leave an old vote from someone who has
 * since turned out to be in the trade, and the count should not trust that.
 */
export function tallyVotes(votes, excluded = []) {
  const out = { fair: 0, collusion: 0, robbery: 0, total: 0 };
  const skip = new Set(excluded);
  for (const v of votes) {
    if (skip.has(v.userId) || !VOTES.includes(v.vote)) continue;
    out[v.vote] += 1;
    out.total += 1;
  }
  return out;
}

/**
 * What a finished vote means.
 *
 *   fewer than QUORUM votes        -> no_quorum  (mods decide)
 *   Collusion or Robbery >= 1/3    -> flagged    (mods decide)
 *   Fair is the top choice         -> approved
 *   anything else                  -> flagged
 *
 * Integer arithmetic on purpose: "a third of the votes" compared with floating
 * point would call 3 of 9 a miss.
 */
export function decide(t) {
  if (t.total < QUORUM) {
    return {
      status: 'no_quorum',
      reason: `Only ${t.total} vote${t.total === 1 ? '' : 's'}; ${QUORUM} are needed.`,
    };
  }
  if (t.collusion * 3 >= t.total) {
    return { status: 'flagged', reason: 'Collusion reached a third of the votes.' };
  }
  if (t.robbery * 3 >= t.total) {
    return { status: 'flagged', reason: 'Robbery reached a third of the votes.' };
  }
  if (t.fair > t.collusion && t.fair > t.robbery) {
    return { status: 'approved', reason: 'Fair was the top choice.' };
  }
  return { status: 'flagged', reason: 'Fair was not the top choice.' };
}

export const customId = (tradeId, vote) => `trade:${tradeId}:${vote}`;

/** The id of a vote button, or null for anything that isn't one. */
export function parseCustomId(id) {
  const m = /^trade:(\d+):(fair|collusion|robbery)$/.exec(String(id ?? ''));
  return m ? { tradeId: Number(m[1]), vote: m[2] } : null;
}

/** Discord button styles: 3 success, 4 danger, 1 primary. */
export function voteComponents(tradeId) {
  const style = { fair: 3, collusion: 4, robbery: 1 };
  return [{
    type: 1,
    components: VOTES.map((v) => ({
      type: 2,
      style: style[v],
      label: LABEL[v],
      custom_id: customId(tradeId, v),
    })),
  }];
}

/**
 * Anything a user typed ends up in a chat message, so it is cut to one line of
 * bounded length. Nothing here can ping anyone: every post from this module
 * goes out with allowed_mentions restricted to the one manager it names.
 */
export function clean(text, max = 100) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const list = (players) => players.map((p) => clean(p.name)).join(', ');

const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

const bar = (n, total) => '█'.repeat(total ? Math.max(n ? 1 : 0, Math.round((n / total) * 10)) : 0);

function tallyLines(t) {
  return VOTES.map((v) => `${LABEL[v].padEnd(9)} ${bar(t[v], t.total).padEnd(10)} ${t[v]}`).join('\n');
}

/** The card an open trade lives on. Edited in place as votes arrive. */
export function proposalMessage({ trade, tally, otherUserId }) {
  const lines = [
    `**Trade #${trade.id}** — ${clean(trade.fromName)} ⇄ ${clean(trade.toName)}`,
    otherUserId
      ? `<@${otherUserId}>, this one involves your team. You and <@${trade.proposerId}> can't vote; everyone else can.`
      : `The two managers in this trade can't vote; everyone else can.`,
    '',
    `**${clean(trade.fromName)} sends:** ${list(trade.give)}`,
    `**${clean(trade.toName)} sends:** ${list(trade.get)}`,
  ];
  if (trade.note) lines.push(`> ${clean(trade.note, MAX_NOTE)}`);
  lines.push(
    '',
    '```',
    tallyLines(tally),
    '```',
    `${tally.total} vote${tally.total === 1 ? '' : 's'} · closes <t:${epoch(trade.closesAt)}:R> · needs at least ${QUORUM} · anonymous, and you can change yours until it closes`
  );
  return lines.join('\n');
}

const FINAL_LINE = {
  approved: (r) => `✅ **Approved by the server.** ${r} Both managers can process it in ESPN.`,
  flagged: (r) => `🚩 **Flagged for the mods.** ${r} Mods: \`/trade approve\` to let it stand, or \`/trade veto\` to call it off.`,
  no_quorum: (r) => `⏳ **Not enough votes.** ${r} Mods: \`/trade approve\` or \`/trade veto\` to settle it.`,
  vetoed: () => `⛔ **Vetoed by a mod.** The trade should not go through.`,
  cancelled: () => `❎ **Cancelled.**`,
  completed: () => `🏁 **Completed in ESPN.**`,
};

/** The same card once voting is over: tally frozen, buttons gone, outcome on top. */
export function closedMessage({ trade, tally, status, reason = '' }) {
  const head = (FINAL_LINE[status] ?? (() => ''))(reason);
  return [
    head,
    '',
    `**Trade #${trade.id}** — ${clean(trade.fromName)} ⇄ ${clean(trade.toName)}`,
    `**${clean(trade.fromName)} sends:** ${list(trade.give)}`,
    `**${clean(trade.toName)} sends:** ${list(trade.get)}`,
    '',
    '```',
    tallyLines(tally),
    '```',
  ].join('\n');
}

/** The separate post announcing how a vote ended. */
export function resultAnnouncement({ trade, tally, decision }) {
  return (
    `**Trade #${trade.id}** (${clean(trade.fromName)} ⇄ ${clean(trade.toName)}): ` +
    `${FINAL_LINE[decision.status](decision.reason)}\n` +
    `Final vote: Fair ${tally.fair} · Collusion ${tally.collusion} · Robbery ${tally.robbery} (${tally.total} vote${tally.total === 1 ? '' : 's'})`
  );
}

/**
 * Check a proposal against the league as it stands.
 *
 * `rosters` is { teams: [{ id, name, players: [{ id, name }] }] }, `live` the
 * trades whose players are still spoken for, `deadline` an epoch in ms or null.
 * Returns { ok: true, from, to, give, get } with names resolved from the
 * rosters, or { ok: false, error } with something a person can act on.
 */
export function validateProposal({ mine, toTeamId, giveIds, getIds, rosters, live = [], deadline = null, now = Date.now() }) {
  const bad = (error) => ({ ok: false, error });
  const from = rosters.teams.find((t) => t.id === mine.teamId);
  const to = rosters.teams.find((t) => t.id === toTeamId);

  if (!from) return bad('Your linked team is no longer in the league. Run `/fantasy link` again.');
  if (!to) return bad('That team is not in the league.');
  if (to.id === from.id) return bad('You cannot trade with yourself.');
  if (deadline && now > deadline) return bad('The trade deadline has passed.');
  if (giveIds.length === 0 || getIds.length === 0) {
    return bad('A trade needs at least one player on each side.');
  }
  if (new Set(giveIds).size !== giveIds.length || new Set(getIds).size !== getIds.length) {
    return bad('The same player is listed twice.');
  }

  const pick = (team, ids, whose) => {
    const out = [];
    for (const id of ids) {
      const p = team.players.find((x) => x.id === id);
      if (!p) return { error: `That player is not on ${whose} roster.` };
      out.push({ id: p.id, name: p.name });
    }
    return { players: out };
  };
  const give = pick(from, giveIds, 'your');
  if (give.error) return bad(give.error);
  const get = pick(to, getIds, `${to.name}'s`);
  if (get.error) return bad(get.error);

  const wanted = new Set([...giveIds, ...getIds]);
  for (const t of live) {
    for (const p of [...t.give, ...t.get]) {
      if (wanted.has(p.id)) {
        return bad(`${p.name} is already in open trade #${t.id}. Cancel that one first.`);
      }
    }
  }
  return {
    ok: true,
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    give: give.players,
    get: get.players,
  };
}

/**
 * Which live trades ESPN has just processed.
 *
 * `items` is the activity feed. A trade shows up there as one "traded" row per
 * player, all sharing a timestamp, so a processed proposal is one whose
 * players are exactly the players of one such timestamp. Exactly, not as a
 * subset: a trade that happens to include one of the same players but is a
 * different deal must not close the proposal.
 */
export function findCompletedTrades(items, trades) {
  const groups = new Map();
  for (const it of items) {
    if (it.kind !== 'traded') continue;
    if (!groups.has(it.date)) groups.set(it.date, new Set());
    groups.get(it.date).add(it.playerId);
  }
  return trades.filter((t) => {
    const ids = new Set([...t.give, ...t.get].map((p) => p.id));
    return [...groups.values()].some(
      (g) => g.size === ids.size && [...ids].every((id) => g.has(id))
    );
  });
}
