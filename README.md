# Comic Chat Web

A TypeScript port of the Microsoft Comic Chat composition engine, validated bit-exact against traces from a patched build of the original open-source C++ client, rendered in the browser on canvas. Based on the open-source Microsoft Comic Chat (MIT, including the original avatar art).

## Develop

```sh
npm install
npm run dev          # Vite gallery at localhost:5173
npm test             # engine unit + golden trace suites
npm run test:browser # Playwright desktop + mobile smoke
npm run check        # biome + strict tsc over src, test, and tools
```

The golden suites replay seven JSONL traces recorded from the instrumented original client (`traces/`); panel seeds, balloon geometry, avatar poses, and emotion picks must match exactly.

## Deploy to Cloudflare

The production build is a static site served by a Cloudflare Worker via the assets binding in `wrangler.jsonc`:

```sh
npm run build
npx wrangler deploy
```

Once this repo has a public Git home, a one-click deploy button can point at it:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<GIT_REPO_URL>)
```

## Art pipeline

`npm run assets:avatars` regenerates the six packed avatar atlases and runtime manifest in `public/assets/avatars/` from the original `.avb` files in the sibling source checkout; `npm run fixtures:avatars` regenerates the test fixture. Both are deterministic and byte-reproducible.
