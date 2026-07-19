# Comic Chat Web

<p>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/remsky/comic-chat-web"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" height="20"></a>
  <img src="https://img.shields.io/badge/tests-182%20passing-brightgreen" alt="182 tests passing" height="20">
  <a href="https://biomejs.dev"><img src="https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome" alt="Checked with Biome" height="20"></a>
</p>


> [!IMPORTANT]
> This is a work in progress. Rooms are anonymous and do not have accounts, moderation, or private-message guarantees.

A TypeScript port of the Microsoft Comic Chat composition engine:

Original engine validated against selected JSONL traces via an instrumented C++ client harness [Comic Chat trace harness](https://github.com/remsky/comic-chat/tree/trace-harness):

| Trace | Validation focus |
| --- | --- |
| `smoke-01` | Core two-speaker flow, balloon modes, emotions, and panel breaks |
| `balloon-01` | Interleaved say, think, whisper, and shout balloon geometry |
| `edge-01` | Single-character, punctuation-only, and repeated messages |
| `emotion-01` | Shouting, laughter, greetings, smileys, pointing, and waving rules |
| `long-01` | Multi-panel overflow, retries, continuation, and three-speaker ordering |
| `speakers-01` | Six-speaker avatar selection, placement, flipping, and ordering |
| `wrap-01` | Long text, wrap boundaries, URLs, and unbreakable words |


<table>
  <tr>
    <td width="60%"><img src="assets/wip-screenshot.png" alt="Comic Chat Web interface showing a three-panel conversation, member list, avatar, and emotion wheel" width="100%" border="1"></td>
    <td width="40%"><img src="assets/wip-select.png" alt="Comic Chat Web connection screen with room, nickname, and character selection controls" width="100%" border="1"></td>
  </tr>
</table>


## What works

- Live, room-based chat over Cloudflare Durable Object WebSockets
- Deterministic comic-panel composition and avatar posing
- Responsive canvas rendering with an accessible transcript
- The full 22-character cast, with automatic emotion posing from message text and the classic emotion wheel
- Bounded, chunked message history with per-socket abuse controls

## Develop

```sh
npm ci
npm run dev          # Vite gallery at localhost:5173
npm test             # engine unit + golden trace suites
npm run test:browser # Playwright desktop + mobile smoke
npm run check        # biome + strict tsc over src, test, and tools
```

## Deploy to Cloudflare

The production build can live on the Free Tier as a static site served by a Cloudflare Worker via the assets binding in `wrangler.jsonc`:

```sh
npm run build
npx wrangler deploy
```

For Cloudflare Workers Builds, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. For a public deployment, also configure a Cloudflare rate-limiting rule for repeated upgrade attempts to `/api/rooms/*/websocket`; the Durable Object separately limits active room sockets and messages sent after an upgrade.

New joins receive the latest 50 messages and can load older history in 50-message chunks. Each room retains at most 500 messages.

## Art pipeline

`npm run assets:avatars` regenerates the packed per-character avatar atlases and runtime manifest in `public/assets/avatars/` from the original `.avb` files in a sibling checkout of the [Comic Chat trace harness](https://github.com/remsky/comic-chat/tree/trace-harness); `npm run fixtures:avatars` regenerates the test fixture. Both are deterministic and byte-reproducible.

## License and Attributions

Except for the third-party material identified below, this project is licensed under the [GNU Affero General Public License v3.0 only](LICENSE). If you operate a modified version over a network, the AGPL requires you to offer its corresponding source to the people using it.

Microsoft-derived code and artwork retain Microsoft's MIT license and notice. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) and the preserved [Microsoft MIT license](LICENSES/MIT-Microsoft.txt) for details.

This is an unofficial community project and is not affiliated with or endorsed by Microsoft. It is based on the [open-source Microsoft Comic Chat repository](https://github.com/microsoft/comic-chat).
