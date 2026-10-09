/**
 * Test doubles shared by the trade and player tests: a small in-memory stand-in
 * for the D1 tables those features use, and a stub for the Discord REST API.
 * Not a test itself, so the suite's glob does not run it.
 */

export function memoryDb() {
  const state = { links: [], trades: [], votes: [], meta: new Map(), nextId: 1 };

  const query = (sql, b) => {
    if (sql.includes('FROM fantasy_links WHERE season = ? AND user_id')) {
      return state.links.filter((l) => l.season === b[0] && l.user_id === b[1]);
    }
    if (sql.includes('FROM fantasy_links WHERE season = ? AND team_id')) {
      return state.links.filter((l) => l.season === b[0] && l.team_id === b[1]);
    }
    if (sql.includes('FROM trades WHERE id = ?')) return state.trades.filter((x) => x.id === b[0]);
    if (sql.includes("status IN ('open'")) {
      return state.trades.filter((x) => x.season === b[0] && ['open', 'approved', 'flagged', 'no_quorum'].includes(x.status));
    }
    if (sql.includes("status = 'open' AND closes_at <= ?")) {
      return state.trades.filter((x) => x.status === 'open' && x.closes_at <= b[0]);
    }
    if (sql.includes('FROM trade_votes')) return state.votes.filter((x) => x.trade_id === b[0]);
    if (sql.includes('FROM meta')) {
      const val = state.meta.get(b[0]);
      return val ? [{ value: val }] : [];
    }
    throw new Error(`the fake database has no answer for: ${sql}`);
  };

  const apply = (sql, b) => {
    if (sql.includes('DELETE FROM fantasy_links')) {
      const before = state.links.length;
      state.links = state.links.filter((l) => !(l.season === b[0] && l.team_id === b[1]));
      return { changes: before - state.links.length };
    }
    if (sql.includes('INSERT INTO fantasy_links')) {
      const found = state.links.find((l) => l.user_id === b[0] && l.season === b[1]);
      if (found) { found.team_id = b[2]; found.team_name = b[3]; return { changes: 1 }; }
      if (state.links.some((l) => l.season === b[1] && l.team_id === b[2])) throw new Error('UNIQUE constraint failed: fantasy_links.team_id');
      state.links.push({ user_id: b[0], season: b[1], team_id: b[2], team_name: b[3], linked_at: b[4] });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO trades')) {
      const id = state.nextId++;
      state.trades.push({
        id, season: b[0], proposer_id: b[1], from_team: b[2], to_team: b[3], from_name: b[4], to_name: b[5],
        give: b[6], get: b[7], note: b[8], status: 'open', channel_id: null, message_id: null,
        created_at: b[9], closes_at: b[10], resolved_at: null,
      });
      return { changes: 1, last_row_id: id };
    }
    if (sql.includes('UPDATE trades SET channel_id')) {
      const x = state.trades.find((y) => y.id === b[2]);
      if (!x) return { changes: 0 };
      x.channel_id = b[0]; x.message_id = b[1];
      return { changes: 1 };
    }
    if (sql.includes('UPDATE trades SET status')) {
      const x = state.trades.find((y) => y.id === b[2] && b.slice(3).includes(y.status));
      if (!x) return { changes: 0 };
      x.status = b[0]; x.resolved_at = b[1];
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO trade_votes')) {
      const found = state.votes.find((x) => x.trade_id === b[0] && x.user_id === b[1]);
      if (found) { found.vote = b[2]; return { changes: 1 }; }
      state.votes.push({ trade_id: b[0], user_id: b[1], vote: b[2], voted_at: b[3] });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO meta')) {
      if (state.meta.has(b[0])) return { changes: 0 };
      state.meta.set(b[0], b[1]);
      return { changes: 1 };
    }
    throw new Error(`the fake database cannot run: ${sql}`);
  };

  return {
    state,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...a) { binds = a; return stmt; },
        async run() { return { success: true, meta: apply(sql, binds) }; },
        async all() { return { results: query(sql, binds) }; },
      };
      return stmt;
    },
  };
}

export function stubApi() {
  const api = { posted: [], edited: [], n: 0, failEdit: false, failPost: false };
  api.postMessage = async (channel, content, mentions, extra) => {
    if (api.failPost) throw new Error('discord down');
    api.posted.push({ channel, content, mentions, extra });
    return { id: `m${++api.n}` };
  };
  api.editMessage = async (channel, id, body) => {
    if (api.failEdit) throw new Error('discord down');
    api.edited.push({ channel, id, body });
    return {};
  };
  return api;
}

export const MANAGE_MESSAGES = String(1 << 13);
export const who = (id, mod = false) => ({ user: { id, username: id }, permissions: mod ? MANAGE_MESSAGES : '0' });
export const MOD = who('mod', true);
export const sub = (name, args) => ({ name, options: Object.entries(args ?? {}).map(([k, val]) => ({ name: k, value: val })) });
export const cmd = (name, subName, args, member) => ({ data: { name, options: [sub(subName, args)] }, member, channel_id: '555' });
