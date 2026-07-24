# AGENTS.md

Guidance for coding agents working on Comic Chat Web.
Agent-assisted contributions are welcome, with caveats:
    - All judgement and accountability falls to the named human contributor as the reviewer.
    - If the user doesn't demonstrate understanding a change, it's not ready to merge.
    - Code style here must still match house style.
    - To the above, explicitly:
        - wanton em-dash usage is not permitted.
        - expositionary and excessive commenting is not permitted.
        - when in doubt, do less. Comments are reserved for decision points, or unexpected gotchas, etc.

The general instructions must also still be followed, same as any contributor, and live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

- `src/engine/` - the composition engine, ported function-by-function from the original '96-'99 C++ (panels, balloons, poses, emotion wheel). Deterministic and trace-validated.
- `src/browser/` - client UI. `room.ts` is the app entry; canvas renderers, widgets, and reconnect logic live alongside it.
- `src/protocol/room.ts` - wire protocol, room defaults, and error-reason constants shared by client and worker.
- `worker/` - Cloudflare Worker. `room.ts` is the chat room Durable Object, `directory.ts` the room directory DO, `moderation.ts` the content filter.
- `worker/db/` - the room's SQL layer, kept out of `room.ts`. `events.ts` is the append-only IRC-style event log (chat, backgrounds, join/part/topic announces) behind a derived row contract; `migrations.ts` the per-room schema runner. DDL steps live as `.sql` in `worker/do_migrations/`.
- `tools/avb/` - asset pipeline: parses the original `.avb`/`.bgb` binaries into the committed PNGs and test fixtures.
- `test/` - vitest unit tests, node project. `test/worker/` - Durable Object tests, run in workerd. `test/browser/` - Playwright specs against the built app.

## Commands

- Unit tests: `npm test` (node and worker projects; `--project worker` for the Durable Object ones alone). Browser tests: `npm run test:browser` (builds, then serves a preview on :4173).
- Format and lint: `npm run format` then `npm run check` (Biome plus tsc for app, tools, worker, and worker tests).
- Dev: `npm run preview:worker` runs the built app with live rooms. `npm run dev` for UI-only hot reload; `npm run dev:api` alongside it if hot reload needs live rooms (vite proxies `/api` to :8787).

## Conventions

- Commit and PR titles use conventional style: `fix: ...`, `feat: ...`, `chore: ...`. Single-line subjects.
- Every behavior change ships with a test.
- `main` stays green. Contribute through normal PRs; releases are `v*` tags cut by the maintainer.
- Engine code tracks the original C++ for traceability (names and comments cite source lines like `balloon.cpp:397`). Match original behavior; don't restructure it to look nicer.
- Keep changes small and modular; match the surrounding style.

## Migrations

- Room storage is an append-only `events` log; the schema advances through numbered steps in `worker/db/migrations.ts`, each run once per room, in order, tracked in `_migrations`.
- Add a step by appending to `MIGRATIONS` - a `.sql` file in `worker/do_migrations/` for DDL, or a function for logic (e.g. `ensureColumns` to backfill columns an ancient room may lack). Steps are forward-only: never edit, reorder, or remove a shipped one.
- Columns read and written derive from `EVENT_SCHEMA` in `events.ts`; update the contract, not scattered SQL. `roomSchema.test.ts` guards that every contract field is backed by a real column.
- Ship the step with a worker test (`roomMigration.test.ts`), then `npm run check` and `npm test`. Migrations run live on real user rooms, so a dry run against exported data is worth it.

## Gotchas

- Asset regeneration (`assets:*`, `fixtures:avatars`) reads a sibling checkout at `../comic-chat` that CI and most machines don't have. The committed PNGs and fixtures are canonical; the build never needs the sibling.
- `vite preview` inherits the dev `/api` proxy, so a running `wrangler dev` leaks into browser tests. Playwright specs must stub `/api` routes to stay hermetic.
