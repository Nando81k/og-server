# Custom emoji

Drop image files in this folder and run:

```
npm run emoji
```

Each file becomes a custom emoji named after it. `bodega tier list.png`
becomes `:bodega_tier_list:`.

Safe to re-run — an emoji that already exists is left alone, so adding one file
later does not mean re-uploading the rest. `DRY_RUN=1 npm run emoji` says what
would happen and uploads nothing.

## What Discord accepts

- **PNG, JPEG, GIF or WebP.** A GIF becomes an animated emoji.
- **256 KB maximum.** Bigger files are refused before anything uploads.
- **128×128 is the sweet spot.** Discord scales anything larger down, and an
  emoji is rendered at about 32px in chat and 48px in the picker — detail below
  that size is wasted, and a photo usually reads as a smudge. Bold shapes and
  high contrast survive; fine lines and small text do not.
- **Names are 2–32 characters**, letters, digits and underscores. The script
  derives one from the filename and refuses anything that would not survive.

## Slots

A server without boosts has **50 static and 50 animated** slots, counted
separately — so running out of one does not stop you adding the other. The
script prints how many of each are used before it starts.

## Naming them well

The name is what people type, so short beats descriptive: `:cooked:` gets used,
`:when_he_gets_cooked_in_2k:` does not. Two files reducing to the same name is
refused rather than uploaded twice, because two emoji nobody can tell apart in
the picker is worse than one.
