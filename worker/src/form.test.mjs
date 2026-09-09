import { renderForm, renderMessage } from './form.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const games = [
  { id: '1', home: 'KC', away: 'BAL', kickoff: '2026-09-13T17:00:00Z' },
  { id: '2', home: 'SF', away: 'NYJ', kickoff: '2026-09-13T20:00:00Z' },
];
const html = renderForm({ games, picks: [], token: 'tok', lockAt: Date.parse(games[0].kickoff) });

check('is a complete document', html.startsWith('<!doctype html>'));
check('names both teams in every game', games.every((g) => html.includes(g.home) && html.includes(g.away)));
check('offers a confidence option per game', (html.match(/<option value="1"/g) || []).length === games.length);
check('caps confidence at the number of games', !html.includes('<option value="3"'));
check('carries the token', html.includes('tok'));
check('is mobile-first', html.includes('width=device-width'));
check('shows the lock time', /lock/i.test(html));

const pre = renderForm({ games, token: 'tok', lockAt: 1, picks: [
  { game_id: '1', team: 'KC', confidence: 2 },
]});
check('preselects an existing pick', /value="KC"[^>]*checked/.test(pre) || pre.includes('data-picked="KC"'));

check('escapes anything from the outside', !renderMessage('<script>x</script>').includes('<script>x'));
check('the message page is a document', renderMessage('gone').startsWith('<!doctype html>'));

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
