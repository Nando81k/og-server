/**
 * How a player reads in Discord: the /player card, and the pieces the trade
 * Explore panel is built from.
 *
 * Pure, like trade.mjs: it takes cards already parsed by fantasy.mjs and
 * returns text, so layout can be tested without ESPN or Discord.
 */

import { CATEGORIES } from './fantasy.mjs';
import { compareChartUrl } from './chart.mjs';

/** One line, bounded, and no backticks (they would end a code block early). */
export function tidy(text, max = 100) {
  return String(text ?? '').replace(/`/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A stat the way a box score prints it: .571 for a percentage, 18.4 for a count. */
export function show(value, cat) {
  if (value === null || value === undefined) return '—';
  return cat.pct ? value.toFixed(3).replace(/^0/, '') : value.toFixed(1);
}

/**
 * The per-game line to use for a player, and what to call it.
 *
 * This season once he has played. Before that, ESPN's own projection for the
 * season, which says more about this year than last year's numbers do, then
 * last season. Null when there is none of them, which is a rookie ESPN has not
 * projected, and the caller says so rather than printing zeros.
 */
export function bestLine(card) {
  const s = card?.stats ?? {};
  if (s.season) return { line: s.season, label: 'this season' };
  if (s.projected) return { line: s.projected, label: 'projected' };
  if (s.prior) return { line: s.prior, label: 'last season' };
  return { line: null, label: null };
}

/** How a non-actual line is flagged next to a player's name. */
export const LABEL_NOTE = { projected: ' (proj.)', 'last season': ' (last season)' };

const lastName = (name) => tidy(name).split(' ').slice(-1)[0].slice(0, 7);

const ARROW_UP = '↑';
const ARROW_DOWN = '↓';
const ARROW_FLAT = '→';

/** Is the recent number better, worse or about the same as the base one? */
function trend(base, recent, cat) {
  if (base === null || recent === null || base === undefined || recent === undefined) return ' ';
  const change = (recent - base) / (Math.abs(base) || 1);
  if (Math.abs(change) < 0.03) return ARROW_FLAT;
  const better = cat.lowerIsBetter ? change < 0 : change > 0;
  return better ? ARROW_UP : ARROW_DOWN;
}

/**
 * A spreadsheet-style grid in monospace rows: ruled lines, a centred header,
 * and every column as wide as its widest cell with a space either side.
 *
 * `align` is 'left' | 'right' | 'center' per column. Discord can't draw a
 * table, so this is a code block of box-drawing characters; it is about 36
 * characters wide for a card, which fits a phone without wrapping.
 */
export function grid(headers, rows, align = []) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const pad = (text, w, how) => {
    const t = String(text ?? '');
    const gap = w - t.length;
    if (how === 'right') return ' '.repeat(gap) + t;
    if (how === 'center') return ' '.repeat(Math.floor(gap / 2)) + t + ' '.repeat(gap - Math.floor(gap / 2));
    return t + ' '.repeat(gap);
  };
  const rule = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const line = (cells, how) => '│' + cells.map((c, i) => ` ${pad(c, widths[i], how(i))} `).join('│') + '│';
  return [
    rule('┌', '┬', '┐'),
    line(headers, () => 'center'),
    rule('├', '┼', '┤'),
    ...rows.map((r) => line(r, (i) => align[i] ?? 'left')),
    rule('└', '┴', '┘'),
  ];
}

/**
 * The per-game table for a card, plus what it is showing.
 *
 * Once he has played: season, last 15 and last 7, with an arrow comparing the
 * last 7 to the season. Before that: ESPN's projection beside last season.
 * Null when there is nothing to show.
 */
export function statsTable(card, cats = CATEGORIES) {
  const { line: base, label } = bestLine(card);
  if (!base) return null;
  const played = label === 'this season';
  const columns = played
    ? [['Season', card.stats.season], ['Last 15', card.stats.last15], ['Last 7', card.stats.last7]]
    : [['Proj.', card.stats.projected], ['Last yr', card.stats.prior]];
  const shown = columns.filter(([, line]) => line);
  const l7 = played ? card.stats.last7 : null;

  const headers = ['', ...shown.map(([t]) => t)];
  const rows = cats.map((cat) => [
    cat.label,
    ...shown.map(([title, line]) => {
      const value = show(line[cat.key], cat);
      // The arrow rides on the last-7 cell, and every cell in that column gets
      // a trailing character so the numbers stay lined up.
      return l7 && line === l7 ? `${value} ${trend(base[cat.key], l7[cat.key], cat)}` : value;
    }),
  ]);
  const note = played
    ? `Per game, ${base.gp ?? '?'} games this season. Arrows compare the last 7 games to the season.`
    : label === 'projected'
      ? 'No games yet this season: ESPN\'s projection beside last season.'
      : 'No games yet this season and no projection: showing last season.';
  return { rows: grid(headers, rows, headers.map((_, i) => (i === 0 ? 'left' : 'right'))), note, label, played };
}

/** ESPN's headshot for a player. If one is missing Discord just shows none. */
export const headshotUrl = (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

/** The colour down the side of the card: how healthy he is. */
export function statusColor(injury) {
  const s = String(injury ?? '').toLowerCase();
  if (s === 'healthy') return 0x2f9e6a;
  if (/day|questionable|doubtful|probable/.test(s)) return 0xd99a2b;
  if (/out|injured|suspend/.test(s)) return 0xd1495b;
  return 0x5b6270;
}

/**
 * The games to chart and a title for them, or null when there are too few.
 * `season` is the one being played, so last season's games are named as such
 * rather than passed off as recent form.
 */
export function chartData(card, cats = CATEGORIES, season = null) {
  const cat = cats.find((c) => !c.pct) ?? CATEGORIES[0];
  const games = (card.games ?? []).filter((g) => typeof g[cat.key] === 'number');
  if (games.length < 3) return null;
  const last = games.at(-1).season;
  const when = last == null || season == null || last === season
    ? `last ${games.length} games`
    : `last ${games.length} games of ${last - 1}-${String(last).slice(-2)}`;
  return {
    title: `${tidy(card.name)} — ${cat.name}, ${when}`,
    values: games.map((g) => g[cat.key]),
  };
}

/**
 * The /player card as a Discord embed: status colour, headshot, the facts as
 * fields, the per-game table, and the chart (when there is one) as the image.
 *
 * Every string a user or ESPN supplied goes through tidy, and the table sits
 * in a code block that tidy keeps free of stray backticks.
 */
export function playerEmbed({ card, owner = null, bio = null, cats = CATEGORIES, chartUrl = null }) {
  const description = [
    [card.position, card.proTeam, card.jersey ? `#${card.jersey}` : null].filter(Boolean).join(' · '),
    `**${tidy(card.injury || 'Healthy')}**`,
  ].filter(Boolean).join('\n');

  const fields = [
    { name: 'ESPN rank', value: card.rank ? `#${card.rank}` : '—', inline: true },
    { name: 'Owned', value: card.owned != null ? `${Math.round(card.owned)}%` : '—', inline: true },
    { name: 'In your league', value: owner ? tidy(owner, 60) : 'Free agent', inline: true },
  ];

  if (bio) {
    const parts = [
      [bio.height, bio.weight].filter(Boolean).join(', '),
      bio.age != null ? `age ${bio.age}` : '',
      bio.college ?? '',
      bio.experience != null ? `${bio.experience} yrs in the league` : '',
    ].filter(Boolean).map((x) => tidy(x, 60));
    if (parts.length) fields.push({ name: 'Bio', value: parts.join(' · '), inline: false });
  }

  const table = statsTable(card, cats);
  fields.push(
    table
      ? { name: 'Per game', value: ['```', ...table.rows, '```'].join('\n'), inline: false }
      : { name: 'Per game', value: 'No games or projection from ESPN yet.', inline: false }
  );

  const embed = {
    title: tidy(card.name, 120),
    url: `https://www.espn.com/nba/player/_/id/${card.id}`,
    color: statusColor(card.injury),
    description,
    thumbnail: { url: headshotUrl(card.id) },
    fields,
  };
  if (chartUrl) embed.image = { url: chartUrl };
  if (table) embed.footer = { text: table.note };
  return embed;
}

const BASIS = { 'this season': 'season', projected: 'proj.', 'last season': 'last yr' };

/** Short column names; two players with the same surname get a first initial. */
function shortNames(cards) {
  const last = cards.map((c) => tidy(c.name).split(' ').slice(-1)[0]);
  return cards.map((c, i) => {
    const dup = last.filter((l) => l === last[i]).length > 1;
    const first = tidy(c.name).split(' ')[0];
    return dup ? `${first[0]}. ${last[i]}`.slice(0, 11) : last[i].slice(0, 10);
  });
}

/**
 * Who leads each category, by what is shown.
 *
 * Compared after rounding to the displayed precision, so two players who both
 * read 2.1 are tied and both marked, not split by an invisible third decimal.
 */
function leaders(entries, cat) {
  const shown = entries.map((e) => (e.line && typeof e.line[cat.key] === 'number' ? Number(show(e.line[cat.key], cat)) : null));
  const real = shown.filter((v) => v !== null);
  if (real.length < 2) return new Set();
  const best = cat.lowerIsBetter ? Math.min(...real) : Math.max(...real);
  return new Set(shown.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0));
}

/**
 * Two to four players side by side, as a Discord embed.
 *
 * One column per player, one row per category the league scores, the best
 * value in each row starred, and a last row counting the categories each
 * leads (this league is decided by categories won). A "Basis" row says whether
 * each column is this season, a projection, or last season, so a veteran's
 * games are not silently set against a rookie's projection.
 *
 * `cards` are parsed player cards in the order asked; `owners` maps player id
 * to the team that has him in this league.
 */
export function compareEmbed({ cards, owners = new Map(), cats = CATEGORIES, season = null }) {
  const entries = cards.map((card) => ({ card, ...bestLine(card) }));
  const names = shortNames(cards);

  const rows = [['Basis', ...entries.map((e) => `${BASIS[e.label] ?? '—'} `)]];
  const wins = entries.map(() => 0);
  for (const cat of cats) {
    const lead = leaders(entries, cat);
    lead.forEach((i) => { wins[i] += 1; });
    rows.push([cat.label, ...entries.map((e, i) => `${show(e.line?.[cat.key], cat)}${lead.has(i) ? '*' : ' '}`)]);
  }
  const enough = entries.filter((e) => e.line).length >= 2;
  if (enough) rows.push(['Leads', ...wins.map((w) => `${w} of ${cats.length} `)]);

  const fields = cards.map((card) => {
    const owner = owners.get(card.id);
    return {
      name: tidy(card.name, 60),
      value: [
        [card.position, card.proTeam, card.jersey ? `#${card.jersey}` : null].filter(Boolean).join(' · ') || '—',
        `**${tidy(card.injury || 'Healthy', 30)}**`,
        [card.rank ? `ESPN #${card.rank}` : null, card.owned != null ? `owned ${Math.round(card.owned)}%` : null].filter(Boolean).join(' · ') || '—',
        owner ? tidy(owner, 40) : 'Free agent',
      ].join('\n'),
      inline: true,
    };
  });
  fields.push({
    name: 'Per game',
    value: ['```', ...grid(['', ...names], rows, ['left', ...names.map(() => 'right')]), '```'].join('\n'),
    inline: false,
  });

  // The chart: the first counting stat, the last games of each, lined up by recency.
  const cat = cats.find((c) => !c.pct) ?? CATEGORIES[0];
  const series = cards.map((card, i) => ({
    label: names[i],
    values: (card.games ?? []).map((g) => g[cat.key]).filter((v) => typeof v === 'number'),
  }));
  const fromOldSeason = cards.some((c) => (c.games ?? []).length && season != null && c.games.at(-1).season !== season);
  const chartUrl = compareChartUrl({ title: `${names.join(' vs ')} — ${cat.name}, recent games`, series });

  const notes = [];
  if (enough) notes.push('* best in the category (ties are both starred). Leads counts categories.');
  else notes.push('Not enough stats from ESPN to compare these players yet.');
  if (enough && new Set(entries.filter((e) => e.line).map((e) => e.label)).size > 1) {
    notes.push('The columns are on different bases (see Basis), so read the leads loosely.');
  }
  if (chartUrl) notes.push(`Chart lines the latest games up at the right.${fromOldSeason ? ' Some games are from last season.' : ''}`);

  const embed = {
    title: tidy(cards.map((c) => c.name).join(' vs '), 250),
    color: 0x6b8afd,
    fields,
    footer: { text: notes.join(' ') },
  };
  if (chartUrl) embed.image = { url: chartUrl };
  return embed;
}

/** Counting stats added up across a side, with null counted as zero. */
export function totals(entries, cats = CATEGORIES) {
  const out = {};
  for (const cat of cats) {
    if (cat.pct) continue;
    const values = entries.map((e) => e.line?.[cat.key]).filter((v) => typeof v === 'number');
    out[cat.key] = values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  return out;
}

/**
 * What the proposer gains or loses in each counting category: what comes in
 * minus what goes out, with `better` already flipped for turnovers.
 */
export function netFor(giving, getting, cats = CATEGORIES) {
  const out = totals(giving, cats);
  const inn = totals(getting, cats);
  return cats.filter((c) => !c.pct).map((cat) => {
    const delta = (inn[cat.key] ?? 0) - (out[cat.key] ?? 0);
    const rounded = Math.round(delta * 10) / 10;
    return {
      key: cat.key,
      label: cat.label,
      delta: rounded,
      better: rounded === 0 ? null : cat.lowerIsBetter ? rounded < 0 : rounded > 0,
      lowerIsBetter: cat.lowerIsBetter,
    };
  });
}

const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

/** One side of a trade as a table: a column per player, and a Total column. */
export function sideTable(title, entries, cats = CATEGORIES) {
  const w = 8;
  const head = ''.padEnd(5) + entries.map((e) => lastName(e.card.name).padEnd(w)).join('') + 'Total';
  const sums = totals(entries, cats);
  const rows = cats.map((cat) => {
    const cells = entries.map((e) => show(e.line?.[cat.key], cat).padEnd(w)).join('');
    return cat.label.padEnd(5) + cells + (cat.pct ? '' : show(sums[cat.key], cat));
  });
  return [`**${tidy(title)}**`, '```', head, ...rows, '```'].join('\n');
}

/** "+6.5" lines, three to a row, for the net block. */
export function netBlock(title, net) {
  const items = net.map((n) => {
    const note = n.delta === 0 ? '' : n.lowerIsBetter ? (n.better ? ' (better)' : ' (worse)') : '';
    return `${n.label} ${signed(n.delta)}${note}`;
  });
  const rows = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3).map((x) => x.padEnd(14)).join('').trimEnd());
  return [`**Net for ${tidy(title)}**`, '```', ...rows, '```'].join('\n');
}
