# Season pick'em — design

**Date:** 2026-09-08
**Status:** approved, not yet implemented

## What this is

A weekly NFL confidence pick'em that feeds the server's season leaderboard.
It is the whole of Phase 3: the season points system has no other source.

## The three decisions everything follows from

**The leaderboard ranks who is best, not who is around most.** Points come
from being right. A consequence worth stating plainly: the top of the board
will settle around the same two or three people, and everyone else stops
checking it. That is accepted, and partly mitigated by the "entered every
week" line described below.

**Results are pulled automatically, never reported.** Nobody enters a score,
nobody confirms anyone else's claim, and nothing can be fudged. The cost is
scope: 2K, CoD, Madden and FGC earn nothing. A pick'em that still runs in
February beats a broader system that dies in October because someone stopped
entering results.

**Picks are confidence-ranked.** Rank all 16 games from 1 to 16. A correct
pick earns its rank; a wrong one earns nothing. Maximum 136 a week. This needs
no data beyond who won, and separates skill far more sharply than straight
winners, where a normal NFL week leaves everyone within two points of each
other.

## Architecture

Everything runs inside the existing Cloudflare Worker. No new hosting.

| Component | Trigger | Responsibility |
|---|---|---|
| Schedule sync | Cron, Tuesday | Fetch the week's games from ESPN, upsert into `games` |
| `/picks` | Slash command | Reply, ephemerally, with a signed link |
| Pick form | `GET /picks?t=…` | Render the slate and any existing picks |
| Pick submit | `POST /picks` | Validate, reject after lock, store |
| Scoring | Cron, Tuesday | Fetch results, set winners, score the finished week |
| Leaderboard | Cron, Tuesday | Post standings to `#season-leaderboard` |

Scoring and the leaderboard share one cron run, ordered: results, then score,
then post. A failure at any step leaves the later ones undone rather than
publishing something half-computed.

### Data source

ESPN's public scoreboard endpoint, verified working on 2026-09-08:

```
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=<season>&seasontype=2&week=<n>
```

No key, no account. A finished game carries `status.type.completed: true`,
`status.type.state: "post"`, and exactly one competitor with `winner: true`.
A tie has `completed: true` and no competitor flagged as the winner — which is
how ties are detected rather than inferred from scores.

This is an undocumented endpoint. It is free and widely used, but it is not a
contract. If it changes shape, scoring stops and says so rather than writing
wrong winners: a week is only scored when every game in it parses cleanly.

### Storage

Cloudflare D1. Two tables.

```sql
CREATE TABLE games (
  id       TEXT PRIMARY KEY,   -- ESPN event id
  season   INTEGER NOT NULL,
  week     INTEGER NOT NULL,
  kickoff  TEXT    NOT NULL,   -- ISO 8601
  home     TEXT    NOT NULL,   -- abbreviation
  away     TEXT    NOT NULL,
  winner   TEXT,               -- abbreviation; NULL until scored
  voided   INTEGER NOT NULL DEFAULT 0  -- tie or abandoned
);

CREATE TABLE picks (
  user_id    TEXT    NOT NULL,  -- Discord user id
  game_id    TEXT    NOT NULL REFERENCES games(id),
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  team       TEXT    NOT NULL,  -- abbreviation the user picked
  confidence INTEGER NOT NULL,  -- 1..N, unique per user per week
  PRIMARY KEY (user_id, game_id)
);
```

There is no standings table. Standings are a query over `picks` joined to
`games`, so they cannot drift out of step with results, and a correction to a
winner instantly corrects every affected total.

## Flows

### Submitting picks

1. User runs `/picks`. The Worker signs `{userId, season, week, exp}` with
   HMAC-SHA256 using a Worker secret, and replies ephemerally with
   `…/picks?t=<payload>.<signature>`.
2. Opening the link verifies the signature and expiry, then renders the week's
   games with any picks already saved.
3. Submitting validates and writes all rows for that user and week atomically.

The form is mobile-first: most people will do this on a phone on a Sunday
morning, and the whole reason for choosing a web form over Discord menus was
that ranking sixteen things has to be tolerable on a small screen.

### Validation

A submission is rejected, with a message saying which rule it broke, unless:

- every game in the week has a pick
- each pick names one of that game's two teams
- confidences are exactly the integers 1..N with no repeats
- the current time is before the lock

### Lock

The whole slate locks at the earliest kickoff of the week. Not per game.

Per-game locking is more precise but makes confidence ranking incoherent — a
user would be reshuffling their order around already-frozen rows. One deadline
also matches what `#pickem`'s pinned post already tells people.

Lock is enforced server-side at submit. The form showing a countdown is a
courtesy, never the control.

### Scoring

For each game in the week:

- `winner` set and `pick.team = winner` → award `confidence`
- `winner` set and mismatched → zero
- `voided` → zero for everyone, and excluded from the week's maximum

A tie voids the game for all players. NFL ties run about one a season, and
every alternative rule pays out on a coin flip.

Scoring is recomputed from stored rows rather than accumulated, so running it
twice produces the same numbers. A user who submitted nothing scores zero for
the week silently; that is not an error condition.

### Leaderboard post

Posted to `#season-leaderboard` on Tuesday: season standings, that week's
points, and a line naming everyone who has entered every week so far.

That last line replaces the "most active" idea from the original sketch, which
would have needed session tracking that this design deliberately excludes. It
does the same job — visible credit for the regulars — using only data the
pick'em already has.

## Failure handling

| Failure | Behaviour |
|---|---|
| ESPN unreachable or malformed | Do nothing, log, retry next cron. Never partially score. |
| A game still in progress | Week is not scored. Whole week waits. |
| Scoring runs twice | Same result; recomputed, not accumulated. |
| No picks from a user | Zero for that week. Silent. |
| Invalid or expired token | Plain page: "That link has expired — run /picks again." |
| Submission after lock | Rejected with the lock time, picks unchanged. |

## Testing

Everything below runs without a token and without network access.

- **Scoring** against saved real ESPN responses, including a completed week, a
  tie, and a week with a game still in progress.
- **Token** signing, verification, expiry, tampering, and a signature from the
  wrong key.
- **Validation**: duplicate confidences, gaps in the range, out-of-range
  values, a missing game, a team not in the game, and submission after lock.
- **Standings** query against a fixture set with a known correct answer.

## Out of scope

Playoffs, other sports, a web standings page, past seasons, and any per-user
statistics beyond points. Each is straightforward to add once a season has
actually run, and a guess if added now.

Playoffs is the one that will need an answer, in January: fewer games make
confidence ranking degenerate, so it likely wants a different scoring rule
rather than the same one applied to a shorter slate.
