# Contributing to Comic Chat Web

Always appreciate community involvement in making this project better.

If using an agentic assistant; repo layout, common commands, and conventions, see [AGENTS.md](AGENTS.md).

## Development Setup

Node 22.13+ and npm. The worker side runs locally through `wrangler` (installed as a dev dependency; no Cloudflare account needed until deploy).

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/remsky/comic-chat-web.git
    cd comic-chat-web
    ```

2.  **Install dependencies:**
    ```bash
    npm ci
    ```

3.  **Run the app:**
    ```bash
    # full app with live rooms: builds, then serves on the worker
    npm run preview:worker

    # UI iteration with hot reload, no live rooms
    npm run dev
    ```
    *Note: for hot reload against live rooms, `npm run dev:api` in a second terminal makes vite proxy `/api` to the worker. Rarely needed.*

## Running Tests

Before submitting changes, please ensure all tests pass as this is an automated requirement.

```bash
npm test
```

This covers two vitest projects: `node` for the engine and protocol, and `worker` for Durable Object behavior inside workerd. Narrow to one with `npm test -- --project worker`.

Browser tests run against the built app and need the Playwright browser once:

```bash
npx playwright install chromium
npm run test:browser
```

*Note: CI runs `npm run check` and `npm test` on PRs and pushes to `main`. Browser tests are local-only for now; run them when touching UI or layout.*

## Code Formatting and Linting

We use Biome for formatting and linting, and tsc for types. Please run both before committing.

1.  **Format the code:**
    ```bash
    npm run format
    ```

2.  **Lint and typecheck:**
    ```bash
    npm run check
    ```
    Review any remaining errors and address them manually; `check` covers the app, the worker, and the asset tools.

## Submitting Changes

0.  Fork the repo
1.  Create a new branch for your feature or bug fix.
2.  Make your changes, following setup, testing, and formatting guidelines above.
3.  Please try to keep your changes inline with the current design, and modular. Large-scale changes will take longer to review and integrate, and have less chance of being approved outright.
    - Touching room storage? It evolves through forward-only migration steps in `worker/db/migrations.ts` (never edit a shipped one), and columns derive from the `events.ts` contract. See [AGENTS.md](AGENTS.md#migrations).
4.  Push your branch to your fork.
5.  Open a Pull Request against the `main` branch of the main repository.

Thank you for contributing!
