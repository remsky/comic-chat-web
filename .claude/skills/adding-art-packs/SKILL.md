---
name: adding-art-packs
description: Add or extend an art pack in comic-chat-web. Which generators to run, which files are hand-maintained, and which tests catch what you missed.
---

# Adding an art pack

Incomplete by design. It covers the sequence and the traps, not every field.

## What a pack is

`src/protocol/castPacks.ts` declares `ART_PACKS`. Each entry claims characters and backdrops by name. Anything no pack claims came with the base v1.0 art and always ships.

`CHARACTER_PACKS` selects what a deploy ships: a comma list of ids, `all`, or `none`. `vite.config.ts` reads it through `loadEnv` with an empty prefix, so a local dotenv file and a Workers Builds var read the same. Unlisted names fail the build with the valid ids.

## Source art lives in a sibling checkout

The avb tools read `../comic-chat`, which is absent on CI:

- `../../../comic-chat/v1.0-pre-modern/comicart/avatars/`
- `../../../comic-chat/v2.1b/cchat/comicart/` and `.../v2.1b/cchat/artpack1/`, in `tools/avb/castSource.ts`
- `../../../comic-chat/v2.5-beta-1/comicart/` and `.../artpack1/`, for backdrops, in `generate-bg-assets.ts`

CI never runs these. It builds from the committed PNGs under `public/assets/`, so a pack is only real once those are regenerated and committed.

## Order of work

1. Add the pack to `ART_PACKS`: `id`, `chip: { label, tone }`, `characters`, `backdrops`.
2. Add a `character-option-chip` modifier class for the new tone to `src/browser/room.css`. The `v2` and `art1` tones are the existing examples. A missing class renders an unstyled badge with no error.
3. Extend `tools/avb/castSource.ts` if the art comes from a release not already listed.
4. Regenerate art: `npm run assets:avatars` and `npm run assets:backgrounds`. Each writes its PNGs plus `manifest.json` under `public/assets/`. `generate-web-assets.ts` takes an optional source override as `argv[2]`.
5. Regenerate fixtures if the parser or the art changed: `npm run fixtures:avatars`, `npm run fixtures:cast-bounds`.
6. Update the hand-maintained prose, below.
7. Run `npm test`. The failures name what is missing.

## Generated files need no thought

`npm run generate` rebuilds all three committed artifacts: the skill's emitted `.mjs` modules, `src/render/comicNeueMetrics.ts`, and the vendored `reference/catalog.json`. Pre-commit runs it on every commit, so a stale artifact fails the commit and is already fixed on disk when it does. Re-stage and commit again. CI runs it then `git diff --exit-code`.

Two rules keep this honest, both easy to break by accident:

- Every generator emits its final bytes. Biome ignores all three outputs, so no second tool can reformat a generated file and turn a dependency bump into a diff nobody caused. A new generator belongs in `npm run generate` and its output belongs in the `files.includes` exclusions in `biome.json`.
- The vendored catalog tracks one pack set, `VENDORED_PACKS` in `src/protocol/castPacks.ts`. The generator and `test/skillCatalog.test.ts` both read it. To ship a new pack in the skill's reference, change that constant, nothing else.

`scripts/generate-skill-catalog.mjs` esbuild-bundles `src/studio/catalogJson.ts` before importing it, because `src/` imports carry `.js` specifiers that bare node cannot resolve. That is why it does not need a vite build, and why it is fast enough for pre-commit.

## Hand-maintained, and it drifts

No generator and no test on the wording, so these go stale silently:

| file | what to add |
| --- | --- |
| `reference/cast.md` | a troupe table row (`name`, `look`, `range`) and a casting-by-register bullet |
| `reference/backgrounds.md` | a backdrop table row |
| `skills/comic-strip/SKILL.md` | the backdrop count in prose |

Counts have been wrong before. They claimed nine backdrops and thirty one characters against a catalog of eight and twenty eight. Nothing checks them, so read them against `catalog.json` whenever a pack changes.

`src/studio/castProse.ts` scrapes `cast.md` for the troupe table and the register bullets at generate time, baking both into `catalog.json`. A row that breaks mid-cell parses as nothing, so the character loses its look and range in both `cast-query.mjs` and `get_bearings`.

## What tells you something is missing

`npm test`, mostly `test/skillCatalog.test.ts`:

- `describes every character the catalog names`: no `cast.md` row
- `names nobody the vendored packs leave out`: a `cast.md` row for a character the pack excludes
- `describes every backdrop the catalog names`: no `backgrounds.md` row
- `carries the catalog the build publishes`: `reference/catalog.json` is stale, so `npm run generate` has not run since the art changed
- `keeps every reference table well formed`: a malformed markdown row
