import { emojiName, mimeFor, rejectReason, isAnimated, MAX_BYTES } from './emoji.mjs';

const fails = [];
const check = (l, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l); if (!c) fails.push(l); };

console.log('--- filenames become emoji names ---');
// Whatever someone names a file is what they get in the picker, so this has to
// be predictable rather than clever.
check('a plain name passes through', emojiName('bodega.png') === 'bodega');
check('the extension goes', emojiName('bodega.gif') === 'bodega');
check('capitals are lowered', emojiName('BigW.png') === 'bigw');
check('spaces become underscores', emojiName('big w.png') === 'big_w');
check('hyphens become underscores', emojiName('big-w.png') === 'big_w');
check('punctuation is dropped', emojiName('no cap!!.png') === 'no_cap');
check('runs collapse to one underscore', emojiName('big   w.png') === 'big_w');
check('leading and trailing separators go', emojiName('--big--.png') === 'big');
check('digits survive', emojiName('2k-rage.png') === '2k_rage');

console.log('\n--- names Discord would refuse ---');
// Rejected here rather than sent, because Discord answers with a 400 that does
// not say which file was wrong.
check('one character is too short', emojiName('w.png') === null);
check('nothing usable is refused', emojiName('!!!.png') === null);
check('over 32 characters is refused', emojiName(`${'a'.repeat(33)}.png`) === null);
check('exactly 32 characters is allowed', emojiName(`${'a'.repeat(32)}.png`) !== null);
check('exactly 2 characters is allowed', emojiName('ww.png') === 'ww');
check('a missing filename does not throw', emojiName(undefined) === null);

console.log('\n--- file types ---');
check('png', mimeFor('a.png') === 'image/png');
check('jpg and jpeg are both jpeg',
  mimeFor('a.jpg') === 'image/jpeg' && mimeFor('a.jpeg') === 'image/jpeg');
check('gif', mimeFor('a.gif') === 'image/gif');
check('webp', mimeFor('a.webp') === 'image/webp');
check('extensions are case insensitive', mimeFor('A.PNG') === 'image/png');
check('anything else is not an image', mimeFor('a.txt') === null);
check('no extension is not an image', mimeFor('a') === null);

console.log('\n--- animated emoji use a separate pool of slots ---');
check('a gif is animated', isAnimated('a.gif'));
check('a png is not', !isAnimated('a.png'));

console.log('\n--- everything is checked before anything uploads ---');
// A run that dies halfway leaves the server half-populated, so a bad file has
// to be caught before the first upload rather than during.
check('a good file is accepted', rejectReason({ filename: 'bodega.png', bytes: 1000 }) === null);
// A single character survives cleaning but Discord still refuses it, so the
// length rule has to be checked after cleaning, not before.
check('a one-character name is refused as unusable',
  /no letters or digits/.test(rejectReason({ filename: 'w.png', bytes: 1000 })));
check('an oversized file is refused',
  /over Discord/.test(rejectReason({ filename: 'bodega.png', bytes: MAX_BYTES + 1 })));
check('exactly at the limit is fine',
  rejectReason({ filename: 'ok.png', bytes: MAX_BYTES }) === null);
check('an empty file is refused', /empty/.test(rejectReason({ filename: 'bodega.png', bytes: 0 })));
check('a non-image is refused', /Discord accepts/.test(rejectReason({ filename: 'a.txt', bytes: 10 })));
check('an unusable name is refused',
  /no letters or digits/.test(rejectReason({ filename: '!!!.png', bytes: 10 })));
check('every refusal explains itself in words',
  [
    { filename: 'a.txt', bytes: 10 },
    { filename: 'bodega.png', bytes: 0 },
    { filename: 'bodega.png', bytes: MAX_BYTES + 1 },
  ].every((f) => typeof rejectReason(f) === 'string' && rejectReason(f).length > 10));

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
