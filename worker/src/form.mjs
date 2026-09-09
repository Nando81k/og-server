/**
 * The pick form.
 *
 * A confidence pick'em is a wager slip: you stake a descending number of points
 * on each game, most-sure first. The page is built around that — committed
 * picks rise into a slip at the top carrying the colour of the team you backed,
 * undecided games wait below, and the number at the top counts down as you go.
 *
 * There is deliberately no house accent colour. Every bit of colour on screen
 * comes from the teams the person picked.
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// `<` inside a JS string literal is still `<` at runtime, but the HTML parser
// can no longer see a closing script tag. Belt and braces alongside the token
// segment check in token.mjs.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const FONTS =
  'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap';

const CSS = `
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --ground:#0d1411; --surface:#15201a; --raised:#1d2b23;
    --ink:#eef2ee; --muted:#8fa396; --line:#ffffff1a;
    --live:#ffb454;
  }
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0;background:var(--ground);color:var(--ink);
    font:16px/1.45 Barlow,system-ui,-apple-system,sans-serif;
    padding-bottom:150px;
  }
  .wrap{max-width:560px;margin:0 auto;padding:0 14px}

  /* The stake counter is the hero: the whole mechanic is this number falling. */
  .stake{position:sticky;top:0;z-index:5;background:var(--ground);
    border-bottom:1px solid var(--line);padding:14px 0 12px;margin-bottom:6px}
  .stake-row{display:flex;align-items:baseline;gap:12px}
  .stake-num{font:700 56px/0.85 'Barlow Condensed',sans-serif;font-variant-numeric:tabular-nums}
  .stake-lab{color:var(--muted);font-size:14px;max-width:22ch}
  .stake-meta{margin-top:8px;color:var(--muted);font-size:13.5px;font-variant-numeric:tabular-nums}
  .stake.done .stake-num{font-size:34px;color:var(--live)}

  h2{font:600 13px/1 Barlow,sans-serif;letter-spacing:.02em;color:var(--muted);
    margin:22px 0 8px;font-weight:500}

  .slip{display:flex;flex-direction:column;gap:6px}
  .staked{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;
    background:var(--pick);cursor:pointer;border:0;width:100%;text-align:left;color:inherit;
    font:inherit;transition:transform .12s ease}
  .staked:active{transform:scale(.99)}
  .staked .pts{font:700 26px/1 'Barlow Condensed',sans-serif;font-variant-numeric:tabular-nums;
    min-width:2.2ch;text-align:right}
  .staked img{width:26px;height:26px;object-fit:contain;flex:none}
  .staked .who{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .staked .vs{color:#ffffffb0;font-size:13px;white-space:nowrap}

  .game{background:var(--surface);border:1px solid var(--line);border-radius:12px;
    margin-bottom:8px;overflow:hidden}
  .when{padding:7px 12px 0;color:var(--muted);font-size:12.5px}
  .sides{display:flex;gap:1px;padding:8px}
  .side{flex:1;min-width:0;display:flex;align-items:center;gap:9px;padding:11px 10px;
    background:var(--raised);border:1px solid transparent;border-radius:9px;cursor:pointer;
    color:inherit;font:inherit;text-align:left;transition:border-color .12s ease,background .12s ease}
  .side:hover{border-color:#ffffff30}
  .side:active{background:#243328}
  .side img{width:30px;height:30px;object-fit:contain;flex:none}
  .side .nm{min-width:0;line-height:1.15}
  .side .city{display:block;color:var(--muted);font-size:11.5px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .side .team{display:block;font-weight:600;font-size:15px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  button:focus-visible,.side:focus-visible{outline:2px solid var(--live);outline-offset:2px}

  .bar{position:fixed;left:0;right:0;bottom:0;background:var(--ground);
    box-shadow:0 -18px 22px -8px var(--ground);
    border-top:1px solid var(--line);padding:12px 14px calc(12px + env(safe-area-inset-bottom))}
  .bar-in{max-width:560px;margin:0 auto}
  #send{width:100%;padding:15px;border:0;border-radius:11px;font:600 17px Barlow,sans-serif;
    background:var(--live);color:#1a1206;cursor:pointer}
  #send[disabled]{background:#25332b;color:var(--muted);cursor:default}
  #msg{margin-top:9px;font-size:14px;color:var(--live);text-align:center;min-height:1.2em}
  .empty{color:var(--muted);padding:10px 2px;font-size:14.5px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const shell = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style></head><body>${body}</body></html>`;

export function renderMessage(text) {
  return shell(
    'Pick’em',
    `<div class="wrap"><div class="stake"><div class="stake-row">
       <div class="stake-num">—</div><div class="stake-lab">${esc(text)}</div>
     </div></div></div>`
  );
}

export function renderForm({ games, teams = {}, picks = [], token, lockAt }) {
  // Fall back to the abbreviation so a team missing from the branding table
  // still renders a usable button rather than a blank one.
  const team = (abbr) =>
    teams[abbr] ?? { abbr, name: abbr, shortName: abbr, logo: '', color: '2b3a31' };

  const data = {
    n: games.length,
    lockAt,
    games: games.map((g) => ({
      id: g.id,
      kickoff: g.kickoff,
      home: brand(team(g.home)),
      away: brand(team(g.away)),
    })),
    // Existing picks come back as an order: highest confidence was picked first.
    order: [...picks]
      .sort((a, b) => b.confidence - a.confidence)
      .map((p) => ({ gameId: p.game_id, team: p.team })),
  };

  return shell(
    'Week picks',
    `<div class="wrap">
  <div class="stake" id="stake">
    <div class="stake-row">
      <div class="stake-num" id="next">—</div>
      <div class="stake-lab" id="lab">Loading your slip…</div>
    </div>
    <div class="stake-meta" id="meta"></div>
  </div>
  <div id="app"></div>
</div>
<div class="bar"><div class="bar-in">
  <button id="send" disabled>Submit picks</button>
  <div id="msg"></div>
</div></div>
<script>
const DATA = ${jsonForScript(data)};
const TOKEN = ${jsonForScript(token)};
</script>
<script>${CLIENT}</script>`
  );
}

function brand(t) {
  return { abbr: t.abbr, name: t.name, short: t.shortName, logo: t.logo, color: t.color };
}

// Kept out of the template literal above so the markup stays readable.
const CLIENT = `
(function(){
  var N = DATA.n, order = DATA.order.slice();
  var app = document.getElementById('app');
  var byId = {}; DATA.games.forEach(function(g){ byId[g.id] = g; });

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function hex(c){ return /^[0-9a-fA-F]{6}$/.test(c) ? '#'+c : '#2b3a31'; }
  function kickoff(iso){
    var d = new Date(iso);
    return d.toLocaleString([], {weekday:'short', hour:'numeric', minute:'2-digit'});
  }
  function pickedIds(){ return order.map(function(p){ return p.gameId; }); }

  function render(){
    var taken = pickedIds();
    var open = DATA.games.filter(function(g){ return taken.indexOf(g.id) === -1; });

    var slip = order.map(function(p, i){
      var g = byId[p.gameId];
      var side = g.home.abbr === p.team ? g.home : g.away;
      var other = g.home.abbr === p.team ? g.away : g.home;
      return '<button class="staked" data-undo="' + esc(g.id) + '" style="--pick:' + hex(side.color) + '">' +
        '<span class="pts">' + (N - i) + '</span>' +
        (side.logo ? '<img src="' + esc(side.logo) + '" alt="">' : '') +
        '<span class="who">' + esc(side.name) + '</span>' +
        '<span class="vs">over ' + esc(other.abbr) + '</span></button>';
    }).join('');

    var rows = open.map(function(g){
      function sideBtn(s){
        var parts = s.name.split(' ');
        var nick = parts.pop();
        var city = parts.join(' ');
        return '<button class="side" data-game="' + esc(g.id) + '" data-team="' + esc(s.abbr) + '">' +
          (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : '') +
          '<span class="nm"><span class="city">' + esc(city || s.abbr) + '</span>' +
          '<span class="team">' + esc(nick) + '</span></span></button>';
      }
      return '<div class="game"><div class="when">' + esc(kickoff(g.kickoff)) + '</div>' +
        '<div class="sides">' + sideBtn(g.away) + sideBtn(g.home) + '</div></div>';
    }).join('');

    app.innerHTML =
      (order.length ? '<h2>Your slip \\u2014 tap to undo</h2><div class="slip">' + slip + '</div>' : '') +
      (open.length ? '<h2>' + open.length + ' still to call</h2>' + rows
                   : '<div class="empty">Every game called. Submit when you\\u2019re happy.</div>');

    var left = N - order.length;
    var unassigned = 0; for (var k = 1; k <= left; k++) unassigned += k;
    document.getElementById('next').textContent = left ? String(left) : 'Set';
    document.getElementById('lab').textContent = left
      ? 'points ride on your next pick'
      : 'All ' + N + ' games called';
    document.getElementById('stake').classList.toggle('done', left === 0);
    document.getElementById('meta').textContent = left
      ? left + ' games left \\u00b7 ' + unassigned + ' points unassigned'
      : 'Locks ' + new Date(DATA.lockAt).toLocaleString([], {weekday:'short', hour:'numeric', minute:'2-digit'});
    document.getElementById('send').disabled = left !== 0;
  }

  app.addEventListener('click', function(e){
    var undo = e.target.closest('[data-undo]');
    if (undo) {
      // Removing a pick shifts everything below it up one, so the numbers stay
      // contiguous and the relative order the person chose survives.
      order = order.filter(function(p){ return p.gameId !== undo.dataset.undo; });
      return render();
    }
    var side = e.target.closest('[data-game]');
    if (side) {
      order.push({ gameId: side.dataset.game, team: side.dataset.team });
      render();
    }
  });

  document.getElementById('send').addEventListener('click', async function(){
    var btn = this, msg = document.getElementById('msg');
    btn.disabled = true; msg.textContent = 'Saving\\u2026';
    var picks = order.map(function(p, i){
      return { game_id: p.gameId, team: p.team, confidence: N - i };
    });
    try {
      var res = await fetch(location.pathname + location.search, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: TOKEN, picks: picks })
      });
      var out = await res.json().catch(function(){ return {}; });
      msg.textContent = res.ok
        ? 'Saved. You can change these until kickoff.'
        : (out.error || 'That did not save. Try again.');
    } catch (err) {
      msg.textContent = 'No connection. Try again.';
    }
    btn.disabled = false;
  });

  render();
})();
`;
