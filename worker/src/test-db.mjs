/**
 * Test doubles shared by the trade and player tests: a small in-memory stand-in
 * for the D1 tables those features use, and a stub for the Discord REST API.
 * Not a test itself, so the suite's glob does not run it.
 */

export function memoryDb() {
  const state = { links: [], trades: [], votes: [], meta: new Map(), nextId: 1, drafts: [], pool: [], dpicks: [], nextDraft: 1 };

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
    if (sql.includes('FROM drafts WHERE id = ?')) return state.drafts.filter((d) => d.id === b[0]);
    if (sql.includes("FROM drafts WHERE season = ? AND status IN ('lobby', 'running')")) {
      return state.drafts.filter((d) => d.season === b[0] && ['lobby', 'running'].includes(d.status)).sort((x, y) => y.id - x.id).slice(0, 1);
    }
    if (sql.includes("FROM drafts WHERE status = 'running'")) return state.drafts.filter((d) => d.status === 'running');
    if (sql.includes('FROM draft_pool p')) {
      const like = sql.includes('LIKE');
      const [draftId, , a, c] = b;
      const term = like ? String(a).replace(/%/g, '').toLowerCase() : '';
      const limit = like ? c : a;
      const taken = new Set(state.dpicks.filter((k) => k.draft_id === draftId).map((k) => k.player_id));
      return state.pool
        .filter((p) => p.draft_id === draftId && !taken.has(p.player_id) && (!like || p.name.toLowerCase().includes(term)))
        .sort((x, y) => x.adp - y.adp || x.player_id - y.player_id)
        .slice(0, limit);
    }
    if (sql.includes('FROM draft_pool WHERE draft_id = ? AND player_id = ?')) {
      return state.pool.filter((p) => p.draft_id === b[0] && p.player_id === b[1]);
    }
    if (sql.includes('FROM draft_picks WHERE draft_id = ?')) {
      return state.dpicks.filter((k) => k.draft_id === b[0]).sort((x, y) => x.pick_no - y.pick_no);
    }
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
    if (sql.includes('INSERT INTO drafts')) {
      const id = state.nextDraft++;
      state.drafts.push({
        id, season: b[0], status: 'lobby', rounds: b[1], clock_seconds: b[2], seats: b[3], pick_no: 1, deadline: null,
        channel_id: null, message_id: null, created_by: b[4], created_at: b[5], finished_at: null,
      });
      return { changes: 1, last_row_id: id };
    }
    if (sql.includes('UPDATE drafts SET channel_id')) {
      const d = state.drafts.find((x) => x.id === b[2]);
      if (!d) return { changes: 0 };
      d.channel_id = b[0]; d.message_id = b[1];
      return { changes: 1 };
    }
    if (sql.includes("UPDATE drafts SET seats = ? WHERE id = ? AND seats = ?")) {
      const d = state.drafts.find((x) => x.id === b[1] && x.seats === b[2] && x.status === 'lobby');
      if (!d) return { changes: 0 };
      d.seats = b[0];
      return { changes: 1 };
    }
    if (sql.includes("UPDATE drafts SET status = 'running'")) {
      const d = state.drafts.find((x) => x.id === b[2] && x.status === 'lobby');
      if (!d) return { changes: 0 };
      d.status = 'running'; d.seats = b[0]; d.pick_no = 1; d.deadline = b[1];
      return { changes: 1 };
    }
    if (sql.includes('UPDATE drafts SET status = ?, finished_at = ?, deadline = NULL')) {
      const d = state.drafts.find((x) => x.id === b[2] && b.slice(3).includes(x.status));
      if (!d) return { changes: 0 };
      d.status = b[0]; d.finished_at = b[1]; d.deadline = null;
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO draft_pool')) {
      for (let i = 0; i < b.length; i += 6) {
        state.pool.push({ draft_id: b[i], player_id: b[i + 1], name: b[i + 2], position: b[i + 3], pro_team: b[i + 4], adp: b[i + 5] });
      }
      return { changes: b.length / 6 };
    }
    if (sql.includes('INSERT INTO draft_picks')) {
      if (state.dpicks.some((k) => k.draft_id === b[0] && (k.pick_no === b[1] || k.player_id === b[3]))) {
        throw new Error('UNIQUE constraint failed: draft_picks');
      }
      state.dpicks.push({
        draft_id: b[0], pick_no: b[1], team_id: b[2], player_id: b[3], player_name: b[4], position: b[5],
        pro_team: b[6], auto: b[7], picked_at: b[8],
      });
      return { changes: 1 };
    }
    if (sql.includes("UPDATE drafts SET pick_no = ?, deadline = NULL, status = 'done'")) {
      const d = state.drafts.find((x) => x.id === b[2] && x.pick_no === b[3]);
      if (!d) return { changes: 0 };
      d.pick_no = b[0]; d.deadline = null; d.status = 'done'; d.finished_at = b[1];
      return { changes: 1 };
    }
    if (sql.includes('UPDATE drafts SET pick_no = ?, deadline = ?')) {
      const d = state.drafts.find((x) => x.id === b[2] && x.pick_no === b[3]);
      if (!d) return { changes: 0 };
      d.pick_no = b[0]; d.deadline = b[1];
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
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
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
