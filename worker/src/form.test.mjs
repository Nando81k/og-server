import { renderForm, renderMessage } from './form.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const teams = {
  KC: { abbr: 'KC', name: 'Kansas City Chiefs', shortName: 'Chiefs', logo: 'https://x/kc.png', color: 'e31837', altColor: 'ffb81c' },
  BAL: { abbr: 'BAL', name: 'Baltimore Ravens', shortName: 'Ravens', logo: 'https://x/bal.png', color: '241773', altColor: '9e7c0c' },
  SF: { abbr: 'SF', name: 'San Francisco 49ers', shortName: '49ers', logo: 'https://x/sf.png', color: 'aa0000', altColor: 'b3995d' },
  NYJ: { abbr: 'NYJ', name: 'New York Jets', shortName: 'Jets', logo: 'https://x/nyj.png', color: '115740', altColor: 'ffffff' },
};
const games = [
  { id: '1', home: 'KC', away: 'BAL', kickoff: '2026-09-13T17:00:00Z' },
  { id: '2', home: 'SF', away: 'NYJ', kickoff: '2026-09-13T20:00:00Z' },
];
const render = (over = {}) =>
  renderForm({ games, teams, picks: [], token: 'tok.sig', lockAt: Date.parse(games[0].kickoff), ...over });

const html = render();

check('is a complete document', html.startsWith('<!doctype html>'));
check('is mobile-first', html.includes('width=device-width'));
check('declares a dark colour scheme', html.includes('color-scheme'));

check('carries every team\'s full name',
  ['Kansas City Chiefs', 'Baltimore Ravens', 'San Francisco 49ers', 'New York Jets']
    .every((n) => html.includes(n)));
check('carries every team logo', Object.values(teams).every((t) => html.includes(t.logo)));
check('carries every team colour', Object.values(teams).every((t) => html.includes(t.color)));
check('carries the games', html.includes('"id":"1"') && html.includes('"id":"2"'));
check('tells the client how many games there are', html.includes('"n":2'));

// The stake counter is the mechanic; it must not be hardcoded to a full slate.
const thirteen = renderForm({
  games: Array.from({ length: 13 }, (_, i) => ({
    id: String(i + 1), home: 'KC', away: 'BAL', kickoff: '2026-09-13T17:00:00Z',
  })),
  teams, picks: [], token: 't.s', lockAt: 1,
});
check('adapts to a bye-week slate of 13', thirteen.includes('"n":13') && !thirteen.includes('"n":16'));

// Existing picks return as an order, highest confidence first.
const withPicks = render({ picks: [
  { game_id: '2', team: 'SF', confidence: 1 },
  { game_id: '1', team: 'KC', confidence: 2 },
]});
const order = JSON.parse(withPicks.match(/const DATA = (\{.*?\});\n/s)[1]).order;
check('reloads existing picks', order.length === 2);
check('reloads them in confidence order, surest first',
  order[0].gameId === '1' && order[1].gameId === '2');
check('reloads which team was backed', order[0].team === 'KC');

check('embeds the token', html.includes('tok.sig'));
const hostileToken = render({ token: 'a.b</script><script>alert(1)</script>' });
check('a break-out in the token cannot escape the script block',
  (hostileToken.match(/<\/script>/g) || []).length === html.match(/<\/script>/g).length);

// Team names come from a third-party feed, so they are not trusted either.
const hostileTeam = renderForm({
  games: [{ id: '1', home: 'KC', away: 'XX', kickoff: '2026-09-13T17:00:00Z' }],
  teams: { ...teams, XX: { abbr: 'XX', name: '<img src=x onerror=alert(1)>', shortName: 'x', logo: 'https://x/x.png', color: '000000' } },
  picks: [], token: 't.s', lockAt: 1,
});
check('escapes a hostile team name', !hostileTeam.includes('<img src=x onerror'));

// A team absent from the branding table must still be pickable.
const missing = renderForm({
  games: [{ id: '9', home: 'ZZZ', away: 'KC', kickoff: '2026-09-13T17:00:00Z' }],
  teams, picks: [], token: 't.s', lockAt: 1,
});
check('an unbranded team still renders', missing.includes('ZZZ'));

check('the message page is a document', renderMessage('gone').startsWith('<!doctype html>'));
check('the message page escapes its text', !renderMessage('<script>x</script>').includes('<script>x<'));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
