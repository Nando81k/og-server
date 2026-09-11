import {
  VIEW_CHANNEL, SEND_MESSAGES, withDeny, withAllow, isDenied, isAllowed, overwriteFor,
} from './permissions.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- denying a role that has no overwrite yet ---');
{
  const out = withDeny([], 'karuta', VIEW_CHANNEL);
  check('adds one entry', out.length === 1);
  check('denies the bit', out[0].deny === String(VIEW_CHANNEL));
  check('allows nothing', out[0].allow === '0');
  check('marks it as a role overwrite', out[0].type === 0);
  check('isDenied agrees', isDenied(out, 'karuta', VIEW_CHANNEL));
}

console.log('\n--- other roles are never disturbed ---');
{
  // The OG category denies @everyone and allows OG and Mod. Adding a bot deny
  // must not touch any of that.
  const before = [
    { id: 'everyone', type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
    { id: 'og', type: 0, allow: String(VIEW_CHANNEL), deny: '0' },
    { id: 'mod', type: 0, allow: String(VIEW_CHANNEL), deny: '0' },
  ];
  const after = withDeny(before, 'karuta', VIEW_CHANNEL);
  check('keeps every existing entry', after.length === 4);
  check('@everyone unchanged', JSON.stringify(overwriteFor(after, 'everyone')) === JSON.stringify(before[0]));
  check('OG still allowed', isAllowed(after, 'og', VIEW_CHANNEL));
  check('Mod still allowed', isAllowed(after, 'mod', VIEW_CHANNEL));
  check('the input array is not mutated', before.length === 3);
}

console.log('\n--- other bits of the same role are never disturbed ---');
{
  const before = [{ id: 'karuta', type: 0, allow: String(SEND_MESSAGES), deny: '0' }];
  const after = withDeny(before, 'karuta', VIEW_CHANNEL);
  check('adds the deny', isDenied(after, 'karuta', VIEW_CHANNEL));
  check('leaves the unrelated allow alone', isAllowed(after, 'karuta', SEND_MESSAGES));
}

console.log('\n--- deny overrides a previous allow of the same bit ---');
{
  const before = [{ id: 'karuta', type: 0, allow: String(VIEW_CHANNEL), deny: '0' }];
  const after = withDeny(before, 'karuta', VIEW_CHANNEL);
  check('no longer allowed', !isAllowed(after, 'karuta', VIEW_CHANNEL));
  check('now denied', isDenied(after, 'karuta', VIEW_CHANNEL));
}

console.log('\n--- allow overrides a previous deny ---');
{
  const before = [{ id: 'karuta', type: 0, allow: '0', deny: String(VIEW_CHANNEL | SEND_MESSAGES) }];
  const after = withAllow(before, 'karuta', VIEW_CHANNEL | SEND_MESSAGES);
  check('now allowed', isAllowed(after, 'karuta', VIEW_CHANNEL | SEND_MESSAGES));
  check('no longer denied', !isDenied(after, 'karuta', VIEW_CHANNEL));
}

console.log('\n--- idempotence ---');
{
  const once = withDeny([], 'karuta', VIEW_CHANNEL);
  const twice = withDeny(once, 'karuta', VIEW_CHANNEL);
  check('applying twice changes nothing', JSON.stringify(once) === JSON.stringify(twice));
  check('a re-run can detect it has nothing to do', isDenied(twice, 'karuta', VIEW_CHANNEL));
}

console.log('\n--- an emptied overwrite is dropped ---');
{
  // Discord rejects an overwrite that neither allows nor denies anything.
  const before = [{ id: 'karuta', type: 0, allow: String(VIEW_CHANNEL), deny: '0' }];
  const after = withAllow(before, 'karuta', 0n);
  check('a no-op allow leaves it intact', after.length === 1);
  const emptied = withDeny([{ id: 'k', type: 0, allow: String(VIEW_CHANNEL), deny: '0' }], 'k', 0n);
  check('still fine when nothing changes', emptied.length === 1);
}

console.log('\n--- reading state safely ---');
{
  check('isDenied on an absent role is false', !isDenied([], 'nobody', VIEW_CHANNEL));
  check('isAllowed on an absent role is false', !isAllowed([], 'nobody', VIEW_CHANNEL));
  check('undefined overwrites do not throw', !isDenied(undefined, 'x', VIEW_CHANNEL));
  check('partial deny is not a full deny',
    !isDenied([{ id: 'k', type: 0, allow: '0', deny: String(VIEW_CHANNEL) }], 'k', VIEW_CHANNEL | SEND_MESSAGES));
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
