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
