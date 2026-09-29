---
name: adding-art-packs
description: Add or extend an art pack in comic-chat-web. Which generators to run, which files are hand-maintained, and which tests catch what you missed.
---

# Adding an art pack

This covers the sequence and the pitfalls, not every field.

## What a pack is

`src/protocol/castPacks.ts` declares `ART_PACKS`. Each entry claims characters and backdrops by name. Anything no pack claims came with the base v1.0 art and always ships.

`CHARACTER_PACKS` selects what a deploy ships: a comma list of ids, `all`, or `none`. `vite.config.ts` reads it through `loadEnv` with an empty prefix, so a local dotenv file and a Workers Builds variable behave the same. An unknown id fails the build and lists the valid ones.

## Source art

Art from the original releases is read from a sibling checkout, `../comic-chat`, which CI does not have:

- `../../../comic-chat/v1.0-pre-modern/comicart/avatars/`
- `../../../comic-chat/v2.1b/cchat/comicart/` and `.../v2.1b/cchat/artpack1/`, in `tools/avb/castSource.ts`
- `../../../comic-chat/v2.5-beta-1/comicart/` and `.../artpack1/`, for backdrops, in `tools/avb/generate-bg-assets.ts`

Avatars that do not come from a release are drop-ins: one JSON in `tools/avb/customAvatars/` plus its atlas PNG under `public/assets/avatars/` (see `peety`), with no sibling checkout needed.

CI never runs the asset generators. It builds from the committed PNGs under `public/assets/`, so a pack only counts once those are regenerated and committed.

## Order of work

1. Add the pack to `ART_PACKS`: `id`, `chip: { label, tone }`, `characters`, `backdrops`.
2. Add a `character-option-chip--<tone>` modifier class for the new tone to `src/browser/room.css`. The existing tones are `v2`, `art1`, and `rem`. A missing class renders an unstyled badge with no error.
3. Extend `tools/avb/castSource.ts` if the art comes from a release not already listed.
4. Regenerate art: `npm run assets:avatars` and `npm run assets:backgrounds`. Each writes its PNGs plus `manifest.json` under `public/assets/`. `generate-web-assets.ts` accepts an optional source override as `argv[2]`.
5. Regenerate fixtures if the parser or the art changed: `npm run fixtures:avatars` and `npm run fixtures:cast-bounds`.
6. Update the hand-maintained prose, below.
7. Run `npm test`. The failures name what is missing.

## Generated files

`npm run generate` rebuilds the three committed artifacts: the skill's emitted `.mjs` modules, `src/render/comicNeueMetrics.ts`, and the vendored `reference/catalog.json`. The pre-commit hook runs it on every commit. If an artifact was stale, the commit fails with the regenerated file already on disk; re-stage and commit again. CI runs `npm run generate` followed by `git diff --exit-code`.

Two rules keep this working:

- Every generator emits its final bytes. Biome ignores all three outputs, so no other tool reformats a generated file. A new generator belongs in `npm run generate`, and its output belongs in the `files.includes` exclusions in `biome.json`.
- The vendored catalog tracks one pack set, `VENDORED_PACKS` in `src/protocol/castPacks.ts`. The generator and `test/skillCatalog.test.ts` both read it. To ship a new pack in the skill's reference, change that constant and nothing else.

`scripts/generate-skill-catalog.mjs` bundles `src/studio/catalogJson.ts` with esbuild before importing it, because `src/` imports use `.js` specifiers that bare node cannot resolve. This avoids a vite build, which keeps the hook fast.

## Hand-maintained files

No generator produces these and no test checks their wording, so they go stale without any failure. Paths are relative to `plugins/comic-strip/skills/comic-strip/`.

| file | what to update |
| --- | --- |
| `reference/cast.md` | a troupe table row (`name`, `look`, `range`) and a casting-by-register bullet |
| `reference/backgrounds.md` | a backdrop table row, and the backdrop counts in its prose |
| `SKILL.md` | the backdrop count in the reference table |

Prose counts drift, so check them against `reference/catalog.json` whenever a pack changes, or avoid stating a count.

`src/studio/castProse.ts` reads `cast.md` for the troupe table and the register bullets at generate time and bakes both into `catalog.json`. A row that breaks mid-cell parses as nothing, so the character loses its look and range in both `cast-query.mjs` and `get_bearings`.

## What flags a missing step

`npm test`, mostly `test/skillCatalog.test.ts`:

- `describes every character the catalog names`: a character has no `cast.md` row
- `names nobody the vendored packs leave out`: `cast.md` has a row for a character the vendored packs exclude
- `describes every backdrop the catalog names`: a backdrop has no `backgrounds.md` row
- `carries the catalog the build publishes`: `reference/catalog.json` is stale, so `npm run generate` has not run since the art changed
- `keeps every reference table well formed`: a malformed markdown row
