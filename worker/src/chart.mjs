/**
 * Chart images, drawn by QuickChart (quickchart.io).
 *
 * Discord messages can't draw a chart, only show an image, so the chart is a
 * URL that QuickChart renders when Discord fetches it. Nothing is sent from
 * here: the URL itself carries the numbers. QuickChart therefore only ever
 * sees public per-game stats and the chart's styling, never a token, a cookie
 * or anything about the server. If the service is down the embed simply has
 * no picture; the rest of the message is unaffected.
 *
 * Pure: it builds a string. Nothing here makes a request.
 */

export const QUICKCHART = 'https://quickchart.io/chart';

/** Discord rejects an embed image URL much past this; stay clear of it. */
export const MAX_URL = 1900;

const rgba = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * An area chart of one number per game, with the average as a dashed line.
 *
 * Returns the URL, or null when there is nothing worth drawing (fewer than
 * three games) or the chart can't be made to fit in a URL. If the average line
 * is what pushes it over, that is dropped before giving up.
 */
export function areaChartUrl({ title, values, color = '#6b8afd', accent = '#d99a2b' }) {
  const data = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).map(round1);
  if (data.length < 3) return null;
  const average = round1(data.reduce((a, b) => a + b, 0) / data.length);

  const build = (withAverage) => {
    const datasets = [{
      label: title.split(' — ')[1] ?? 'per game',
      data,
      fill: true,
      borderColor: color,
      backgroundColor: rgba(color, 0.28),
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: color,
      lineTension: 0.35,
    }];
    if (withAverage) {
      datasets.push({
        label: `Average ${average}`,
        data: data.map(() => average),
        fill: false,
        borderColor: accent,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
      });
    }
    const config = {
      type: 'line',
      data: { labels: data.map((_, i) => i + 1), datasets },
      options: {
        title: { display: true, text: title, fontColor: '#eceef1', fontSize: 16 },
        legend: withAverage
          ? { display: true, labels: { fontColor: '#c9ced6', boxWidth: 14 } }
          : { display: false },
        scales: {
          yAxes: [{ ticks: { beginAtZero: true, fontColor: '#a0a7b0' }, gridLines: { color: '#33373e' } }],
          xAxes: [{ ticks: { fontColor: '#a0a7b0' }, gridLines: { display: false } }],
        },
      },
    };
    return `${QUICKCHART}?bkg=%231b1d21&w=640&h=300&v=2.9.4&c=${encodeURIComponent(JSON.stringify(config))}`;
  };

  for (const withAverage of [true, false]) {
    const url = build(withAverage);
    if (url.length <= MAX_URL) return url;
  }
  return null;
}

/** One colour per compared player, readable on the dark background. */
export const SERIES_COLORS = ['#6b8afd', '#f0b25a', '#5fd0a0', '#e68ab8'];

/**
 * Several players' recent games on one area chart.
 *
 * `series` is [{ label, values }], newest game last. Games are lined up by
 * recency (the latest game of each at the right edge), because two players
 * rarely play on the same nights; a player with fewer games leaves a gap on
 * the left. Players with under three games are left out, and with fewer than
 * two players left there is nothing to compare, so it returns null.
 *
 * Four players' numbers do not all fit in a URL, so it tries 15 games, then
 * 10, 7 and 5, and gives up only if even that is too long.
 */
export function compareChartUrl({ title, series }) {
  const usable = series
    .map((s) => ({ label: s.label, values: s.values.filter((v) => typeof v === 'number' && Number.isFinite(v)).map(round1) }))
    .filter((s) => s.values.length >= 3);
  if (usable.length < 2) return null;

  for (const window of [15, 10, 7, 5]) {
    const trimmed = usable.map((s) => ({ ...s, values: s.values.slice(-window) }));
    const n = Math.max(...trimmed.map((s) => s.values.length));
    // Kept lean on purpose: every character is multiplied by URL-encoding, and
    // four players' worth of numbers is close to the limit. Styling shared by
    // all the lines lives once under `elements` instead of on each dataset.
    const config = {
      type: 'line',
      data: {
        labels: Array.from({ length: n }, (_, i) => i + 1),
        datasets: trimmed.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          return {
            label: s.label,
            data: [...Array(n - s.values.length).fill(null), ...s.values],
            fill: true,
            borderColor: color,
            backgroundColor: rgba(color, 0.18),
          };
        }),
      },
      options: {
        elements: { line: { tension: 0.35, borderWidth: 2 }, point: { radius: 0 } },
        title: { display: true, text: title, fontColor: '#eceef1', fontSize: 15 },
        legend: { labels: { fontColor: '#c9ced6', boxWidth: 14 } },
        scales: {
          yAxes: [{ ticks: { beginAtZero: true, fontColor: '#a0a7b0' }, gridLines: { color: '#33373e' } }],
          xAxes: [{ ticks: { fontColor: '#a0a7b0' }, gridLines: { display: false } }],
        },
      },
    };
    const url = `${QUICKCHART}?bkg=%231b1d21&w=640&h=300&v=2.9.4&c=${encodeURIComponent(JSON.stringify(config))}`;
    if (url.length <= MAX_URL) return url;
  }
  return null;
}
