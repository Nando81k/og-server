const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const shell = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:20px;background:#17151a;color:#f2ede2;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:640px;margin:0 auto}
  h1{font-size:1.4rem;margin:0 0 4px}
  .sub{color:#a49c8e;font-size:.9rem;margin-bottom:20px}
  .game{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #ffffff1a}
  .teams{flex:1;display:flex;gap:8px}
  label.team{flex:1;padding:10px;border:1px solid #ffffff26;border-radius:8px;text-align:center;cursor:pointer}
  label.team:has(input:checked){background:#e8531f;border-color:#e8531f;color:#fff}
  label.team input{position:absolute;opacity:0}
  select{background:#221f26;color:#f2ede2;border:1px solid #ffffff26;border-radius:8px;padding:10px;font-size:16px}
  button{width:100%;margin-top:20px;padding:14px;font-size:16px;font-weight:600;
    background:#e8531f;color:#fff;border:0;border-radius:8px;cursor:pointer}
  #msg{margin-top:12px;color:#ff8452}
</style></head><body>${body}</body></html>`;

export function renderMessage(text) {
  return shell('Pick’em', `<h1>Pick&rsquo;em</h1><p>${esc(text)}</p>`);
}

export function renderForm({ games, picks = [], token, lockAt }) {
  const n = games.length;
  const chosen = new Map(picks.map((p) => [p.game_id, p]));

  const rows = games
    .map((g) => {
      const p = chosen.get(g.id);
      const team = (t) =>
        `<label class="team"><input type="radio" name="t_${esc(g.id)}" value="${esc(t)}"${
          p && p.team === t ? ' checked' : ''
        }>${esc(t)}</label>`;
      const opts = Array.from({ length: n }, (_, i) => n - i)
        .map((v) => `<option value="${v}"${p && p.confidence === v ? ' selected' : ''}>${v}</option>`)
        .join('');
      return `<div class="game" data-game="${esc(g.id)}"${p ? ` data-picked="${esc(p.team)}"` : ''}>
        <div class="teams">${team(g.away)}${team(g.home)}</div>
        <select name="c_${esc(g.id)}"><option value="">-</option>${opts}</select>
      </div>`;
    })
    .join('');

  const body = `<h1>Week picks</h1>
<div class="sub">Pick every winner, then rank them ${n} (most sure) down to 1.
Locks at ${esc(new Date(lockAt).toUTCString())}.</div>
<form id="f">${rows}<button type="submit">Submit picks</button><div id="msg"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const picks = [...document.querySelectorAll('.game')].map((row) => {
    const id = row.dataset.game;
    const team = row.querySelector('input[name="t_' + id + '"]:checked');
    const conf = row.querySelector('select').value;
    return { game_id: id, team: team && team.value, confidence: Number(conf) };
  });
  const res = await fetch(location.pathname + location.search, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: ${JSON.stringify(token).replace(/</g, '\\u003c')}, picks }),
  });
  const out = await res.json().catch(() => ({ error: 'Something went wrong.' }));
  document.getElementById('msg').textContent = res.ok ? 'Saved. You can change these until lock.' : out.error;
});
</script>`;
  return shell('Week picks', body);
}
