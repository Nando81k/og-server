/**
 * How a player reads in Discord: the /player card, and the pieces the trade
 * Explore panel is built from.
 *
 * Pure, like trade.mjs: it takes cards already parsed by fantasy.mjs and
 * returns text, so layout can be tested without ESPN or Discord.
 */

import { CATEGORIES } from './fantasy.mjs';

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
 * The per-game table for a card, as monospace rows, plus what it is showing.
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

  const widths = [5, 9, 9, 8];
  const rows = [['', ...shown.map(([t]) => t)].map((h, i) => h.padEnd(widths[i])).join('').trimEnd()];
  for (const cat of cats) {
    const cells = [cat.label, ...shown.map(([, line]) => show(line[cat.key], cat))];
    let row = cells.map((c, i) => String(c).padEnd(widths[i])).join('');
    if (l7) row += trend(base[cat.key], l7[cat.key], cat);
    rows.push(row.trimEnd());
  }
  const note = played
    ? `Per game, ${base.gp ?? '?'} games this season. Arrows compare the last 7 games to the season.`
    : label === 'projected'
      ? 'No games yet this season: ESPN\'s projection beside last season.'
      : 'No games yet this season and no projection: showing last season.';
  return { rows, note, label, played };
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
