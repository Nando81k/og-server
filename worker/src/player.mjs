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
 * This season once he has played; last season before that, so a card is still
 * useful in October. Null when there is neither, which is a rookie or a player
 * back from a long absence, and the caller says so rather than printing zeros.
 */
export function bestLine(card) {
  const s = card?.stats ?? {};
  if (s.season) return { line: s.season, label: 'this season' };
  if (s.prior) return { line: s.prior, label: 'last season' };
  return { line: null, label: null };
}

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

/** The public /player card. */
export function playerMessage({ card, owner = null, bio = null }) {
  const lines = [
    `**${tidy(card.name)}** — ${[card.position, card.proTeam, card.injury].filter(Boolean).join(' · ')}`,
  ];

  const facts = [];
  if (card.rank) facts.push(`ESPN rank #${card.rank}`);
  if (card.owned !== null && card.owned !== undefined) facts.push(`owned in ${Math.round(card.owned)}% of leagues`);
  facts.push(owner ? `on **${tidy(owner)}** in your league` : 'not on a team in your league');
  lines.push(facts.join(' · '));

  if (bio) {
    const parts = [
      [bio.height, bio.weight].filter(Boolean).join(', '),
      bio.age !== null && bio.age !== undefined ? `age ${bio.age}` : '',
      bio.college ?? '',
      bio.experience !== null && bio.experience !== undefined ? `${bio.experience} yrs in the league` : '',
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(' · '));
  }

  const { line: base, label } = bestLine(card);
  if (!base) {
    lines.push('', 'No stats yet. He has not played this season or last.');
    return lines.join('\n');
  }
  const l15 = card.stats.season ? card.stats.last15 : null;
  const l7 = card.stats.season ? card.stats.last7 : null;

  const head = ['', card.stats.season ? 'Season' : 'Last yr', l15 ? 'Last 15' : null, l7 ? 'Last 7' : null]
    .filter((h) => h !== null);
  const widths = [5, 9, 9, 8];
  const rows = [head.map((h, i) => h.padEnd(widths[i])).join('')];
  for (const cat of CATEGORIES) {
    const cells = [cat.label, show(base[cat.key], cat)];
    if (l15) cells.push(show(l15[cat.key], cat));
    if (l7) cells.push(show(l7[cat.key], cat));
    let row = cells.map((c, i) => String(c).padEnd(widths[i])).join('');
    if (l7) row += trend(base[cat.key], l7[cat.key], cat);
    rows.push(row);
  }
  lines.push('```', ...rows, '```');
  lines.push(
    label === 'last season'
      ? 'Showing last season: no games played yet this season.'
      : `Per game, ${base.gp ?? '?'} games this season. Arrows compare the last 7 games to the season.`
  );
  return lines.join('\n');
}

/** Counting stats added up across a side, with null counted as zero. */
export function totals(entries) {
  const out = {};
  for (const cat of CATEGORIES) {
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
export function netFor(giving, getting) {
  const out = totals(giving);
  const inn = totals(getting);
  return CATEGORIES.filter((c) => !c.pct).map((cat) => {
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
export function sideTable(title, entries) {
  const w = 8;
  const head = ''.padEnd(5) + entries.map((e) => lastName(e.card.name).padEnd(w)).join('') + 'Total';
  const sums = totals(entries);
  const rows = CATEGORIES.map((cat) => {
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
