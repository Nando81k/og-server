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

  /* Games never move. Picking fills the side in place, so nothing reflows
     under the finger that just tapped it. */
  .side.on{background:var(--pick);border-color:#ffffff45}
  .side.on .city{color:#ffffffc4}
  .side .pts{margin-left:auto;font:700 22px/1 'Barlow Condensed',sans-serif;
    font-variant-numeric:tabular-nums;opacity:0;transition:opacity .14s ease}
  .side.on .pts{opacity:1}
  .game.called{border-color:#ffffff2e}

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

  /* Submitting is the one moment worth interrupting for. */
  .veil{position:fixed;inset:0;background:#060a08d9;display:flex;align-items:center;
    justify-content:center;padding:24px;z-index:20}
  .veil[hidden]{display:none}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:16px;
    padding:26px 22px;max-width:340px;width:100%;text-align:center}
  .card .tick{font:700 46px/1 'Barlow Condensed',sans-serif;color:var(--live)}
  .card h2{font:700 24px/1.15 'Barlow Condensed',sans-serif;color:var(--ink);
    margin:8px 0 6px;letter-spacing:0}
  .card p{color:var(--muted);margin:0 0 18px;font-size:15px}
  .card button{width:100%;padding:13px;border:0;border-radius:10px;
    font:600 16px Barlow,sans-serif;background:var(--live);color:#1a1206;cursor:pointer}
  .card.bad .tick{color:#ff7a6b}

  /* Standalone states (expired link, no open week). Not the pick form, so it
     does not borrow the stake hero — a giant em dash reads as a glitch. */
  .note{max-width:32ch;margin:0 auto;padding:22vh 20px 0}
  .note h1{font:700 30px/1.1 'Barlow Condensed',sans-serif;margin:0 0 10px}
  .note p{color:var(--muted);margin:0;font-size:16px}
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
    `<div class="note"><h1>Nothing to pick here</h1><p>${esc(text)}</p></div>`
  );
}

export function renderForm({ games, teams = {}, picks = [], token, lockAt, guildId = '' }) {
  // Fall back to the abbreviation so a team missing from the branding table
  // still renders a usable button rather than a blank one.
  const team = (abbr) =>
    teams[abbr] ?? { abbr, name: abbr, shortName: abbr, logo: '', color: '2b3a31' };

  const data = {
    n: games.length,
    lockAt,
    // Where the "back to Discord" button goes. A universal link, so on a phone
    // the Discord app takes over rather than opening the web client.
    back: guildId ? `https://discord.com/channels/${encodeURIComponent(guildId)}` : '',
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
<div class="veil" id="veil" hidden role="dialog" aria-modal="true" aria-labelledby="vt">
  <div class="card" id="card">
    <div class="tick" id="vi">&#10003;</div>
    <h2 id="vt"></h2>
    <p id="vp"></p>
    <button id="vb"></button>
  </div>
</div>
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
  var send = document.getElementById('send');
  var veil = document.getElementById('veil');

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function hex(c){ return /^[0-9a-fA-F]{6}$/.test(c) ? '#'+c : '#2b3a31'; }
  function when(iso){
    return new Date(iso).toLocaleString([], {weekday:'short', hour:'numeric', minute:'2-digit'});
  }
  function indexOfPick(gameId){
    for (var i=0;i<order.length;i++) if (order[i].gameId === gameId) return i;
    return -1;
  }

  // Built ONCE. Every later change touches only the elements that changed, so
  // the list never rebuilds and nothing shifts under the finger mid-tap.
  app.innerHTML = DATA.games.map(function(g){
    function side(s){
      var parts = s.name.split(' '), nick = parts.pop(), city = parts.join(' ');
      return '<button class="side" data-game="' + esc(g.id) + '" data-team="' + esc(s.abbr) + '"' +
        ' style="--pick:' + hex(s.color) + '" aria-pressed="false">' +
        (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : '') +
        '<span class="nm"><span class="city">' + esc(city || s.abbr) + '</span>' +
        '<span class="team">' + esc(nick) + '</span></span>' +
        '<span class="pts"></span></button>';
    }
    return '<div class="game" data-row="' + esc(g.id) + '">' +
      '<div class="when">' + esc(when(g.kickoff)) + '</div>' +
      '<div class="sides">' + side(g.away) + side(g.home) + '</div></div>';
  }).join('');

  var sides = Array.prototype.slice.call(app.querySelectorAll('.side'));

  function paint(){
    sides.forEach(function(el){
      var i = indexOfPick(el.dataset.game);
      var on = i !== -1 && order[i].team === el.dataset.team;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.querySelector('.pts').textContent = on ? String(N - i) : '';
    });
    app.querySelectorAll('.game').forEach(function(row){
      row.classList.toggle('called', indexOfPick(row.dataset.row) !== -1);
    });

    var left = N - order.length, unassigned = 0;
    for (var k = 1; k <= left; k++) unassigned += k;
    document.getElementById('next').textContent = left ? String(left) : String(N);
    document.getElementById('lab').textContent = left
      ? 'points ride on your next pick'
      : 'games called \\u2014 ready to submit';
    document.getElementById('stake').classList.toggle('done', left === 0);
    document.getElementById('meta').textContent = left
      ? left + ' still to call \\u00b7 ' + unassigned + ' points unassigned'
      : 'Locks ' + when(DATA.lockAt);
    send.disabled = left !== 0;
    send.textContent = left ? 'Pick all ' + N + ' to submit' : 'Submit picks';
  }

  app.addEventListener('click', function(e){
    var el = e.target.closest('[data-game]');
    if (!el) return;
    var i = indexOfPick(el.dataset.game);
    if (i !== -1 && order[i].team === el.dataset.team) {
      order.splice(i, 1);
    } else if (i !== -1) {
      order[i] = { gameId: el.dataset.game, team: el.dataset.team };
    } else {
      order.push({ gameId: el.dataset.game, team: el.dataset.team });
    }
    paint();
  });

  var vb = document.getElementById('vb');
  var leaving = false;

  function popup(ok, title, body){
    document.getElementById('card').classList.toggle('bad', !ok);
    document.getElementById('vi').textContent = ok ? '\\u2713' : '!';
    document.getElementById('vt').textContent = title;
    document.getElementById('vp').textContent = body;
    // Only a successful save offers to leave; a failure keeps you here to retry.
    leaving = ok && !!DATA.back;
    vb.textContent = leaving ? 'Back to Discord' : 'Back to my picks';
    veil.hidden = false;
    vb.focus();
  }

  vb.addEventListener('click', function(){
    if (!leaving) { veil.hidden = true; return; }
    // A tab the browser opened by following a link cannot be closed by script,
    // so this usually does nothing. Navigating is the reliable path; the app
    // picks up the universal link on a phone.
    window.close();
    setTimeout(function(){ location.href = DATA.back; }, 120);
  });
  veil.addEventListener('click', function(e){ if (e.target === veil) veil.hidden = true; });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') veil.hidden = true; });

  send.addEventListener('click', async function(){
    send.disabled = true;
    var was = send.textContent;
    send.textContent = 'Saving\\u2026';
    var picks = order.map(function(p, i){
      return { game_id: p.gameId, team: p.team, confidence: N - i };
    });
    try {
      var res = await fetch(location.pathname + location.search, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ token: TOKEN, picks: picks })
      });
      var out = await res.json().catch(function(){ return {}; });
      if (res.ok) {
        var top = order[0], g = null;
        DATA.games.forEach(function(x){ if (x.id === top.gameId) g = x; });
        var name = g ? (g.home.abbr === top.team ? g.home.name : g.away.name) : top.team;
        popup(true, 'Your picks are in',
          'All ' + N + ' games ranked, with ' + N + ' points on ' + name +
          '. You can change them until ' + when(DATA.lockAt) + '.');
      } else {
        popup(false, 'Not saved', out.error || 'Something went wrong. Try again.');
      }
    } catch (err) {
      popup(false, 'Not saved', 'No connection. Your picks are still on screen \\u2014 try again.');
    }
    send.textContent = was;
    paint();
  });

  paint();
})();
`;
