import { COMMANDS, lfgGameChoices } from './commands.mjs';
import { GAME_ROLES, GAME_VOICE, voiceRoomFor } from './lib.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

const GAMES = lfgGameChoices();

console.log('--- /lfg choices and the maps that answer them ---');
// The point of this file. Discord will happily accept a fifth choice here;
// the Worker resolves it through GAME_ROLES and GAME_VOICE, and voiceRoomFor
// throws on anything missing. So a choice added in one place and not the
// other is a command that 500s for whoever picks it. These read the real
// definition rather than a list typed out beside it, so adding a game breaks
// the test until its role and room exist.
check(`/lfg offers ${GAMES.length} games`, GAMES.length > 0);
for (const g of GAMES) {
  check(`"${g}" has a role to ping`, Boolean(GAME_ROLES[g]));
  check(`"${g}" has a voice room`, Boolean(GAME_VOICE[g]));
  check(`"${g}" resolves without throwing`,
    (() => { try { voiceRoomFor(g); return true; } catch { return false; } })());
}
// The other direction: a role or room for a game nobody can pick is dead
// weight, and usually means a choice was removed and its map entry left.
check('no role for a game /lfg does not offer',
  Object.keys(GAME_ROLES).every((g) => GAMES.includes(g)));
check('no voice room for a game /lfg does not offer',
  Object.keys(GAME_VOICE).every((g) => GAMES.includes(g)));

console.log('\n--- choices are well formed ---');
const lfg = COMMANDS.find((c) => c.name === 'lfg');
const game = lfg.options.find((o) => o.name === 'game');
check('every choice has a label and a value',
  game.choices.every((c) => typeof c.name === 'string' && c.name && typeof c.value === 'string' && c.value));
const values = game.choices.map((c) => c.value);
check('no duplicate values', new Set(values).size === values.length);
const labels = game.choices.map((c) => c.name);
check('no duplicate labels', new Set(labels).size === labels.length);
// Discord rejects the whole registration over these, and the error points at
// the payload rather than the offending field.
check('at most 25 choices', game.choices.length <= 25);
check('every value fits Discord\'s 100 character limit',
  values.every((v) => [...v].length <= 100));

console.log('\n--- the commands Discord is told about ---');
check('registers exactly the commands we mean to',
  COMMANDS.map((c) => c.name).sort().join(',') === 'award,lfg,picks');
check('every command has a name and description',
  COMMANDS.every((c) => c.name && c.description));
check('no duplicate command names',
  new Set(COMMANDS.map((c) => c.name)).size === COMMANDS.length);
check('names are lowercase, as Discord requires',
  COMMANDS.every((c) => c.name === c.name.toLowerCase()));
check('descriptions fit Discord\'s 100 character limit',
  COMMANDS.every((c) => [...c.description].length <= 100));
// A required option listed after an optional one is rejected outright.
check('required options come before optional ones',
  COMMANDS.every((c) => {
    const req = (c.options ?? []).map((o) => Boolean(o.required));
    return req.indexOf(true) <= req.lastIndexOf(true) &&
      !req.slice(req.lastIndexOf(true) + 1).includes(true) &&
      req.every((r, i) => !r || !req.slice(0, i).includes(false));
  }));

console.log('\n--- /award is gated at the Discord level ---');
const award = COMMANDS.find((c) => c.name === 'award');
check('/award is registered', Boolean(award));
// Without this, every member sees a command that hands out season points.
check('it is hidden from members without Manage Messages',
  award.default_member_permissions === String(1 << 13));
check('the permission is a string, as Discord requires',
  typeof award.default_member_permissions === 'string');
check('it takes a user, a number and a reason',
  award.options.map((o) => o.type).join() === '6,4,3');
check('all three are required', award.options.every((o) => o.required === true));
check('the reason is free text, so it can say what it was for',
  award.options.find((o) => o.name === 'reason').type === 3);

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
