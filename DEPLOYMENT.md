# Deployment

Build with `npm run build`, deploy with `npx wrangler deploy`. Cloudflare Workers Builds runs both on a push to `main`.

## Configuration

Two runtime vars, in `wrangler.jsonc` or the dashboard. Operator details are build variables instead; see [Naming the operator](#naming-the-operator).

| Var | Default | Effect |
| --- | --- | --- |
| `ROOMS` | `lobby`, `tech-news`, `weather-chat` | Only these rooms accept connections, bounding how many Durable Objects a deploy can create. There is no built-in default; the list ships in `wrangler.jsonc`. |
| `MODERATION` | `on` | `off` drops the profanity screen from chat and the studio, and returns 404 from `/api/moderate`. Any other value leaves it on. |

Clearing `ROOMS` closes a deploy: nothing is listed and every join returns 403 before a Durable Object is touched. Sockets already open stay up until they drop.

## Limits

Everything else is a source constant. These are safety rails, and changing one means editing the source:

| Limit | Value | Source |
| --- | --- | --- |
| Sockets per room | 12 | `worker/room.ts` |
| Send rate | 5 burst, 1/s refill | `worker/room.ts` |
| Flood disconnect | 20 straight drops | `worker/room.ts` |
| Mute after a blocked message | 15s, times the strike count | `worker/room.ts` |
| Disconnect after blocked messages | 5 | `worker/room.ts` |
| History chunk | 50 messages | `src/protocol/room.ts` |
| History retention | 100 messages per room | `worker/db/events.ts` |
| Screen batch | 200 texts, first 2000 chars of each screened | `worker/index.ts` |

Before opening a deploy to the public, add a Cloudflare rate-limiting rule on `/api/*` and a usage notification. Worker invocations scale with automated abuse.

## Request logs

`wrangler.jsonc` sets `observability.logs.invocation_logs` to `false`. Turning it on writes one log per connection carrying the client IP, the geo and ASN Cloudflare derives from it, and the user agent, plus one per WebSocket message, all into **your** Cloudflare account for 3 days on the Free plan and 7 on Paid. That makes the operator a custodian of visitor IP addresses, and `legal.html` states the opposite. A deploy that wants them must amend that page.

Left off, `console` output and uncaught exceptions still reach Workers Logs. Cloudflare keeps its own connection records for its own purposes either way, which is what the privacy policy points at.

## Naming the operator

`legal.html` holds the terms and privacy text and names no operator. A deploy supplies its own through four build variables, listed in `.env.example`:

| Variable | Fills |
| --- | --- |
| `LEGAL_CONTACT` | Takedown and privacy address, also named on the report page and stamped on the report transcript |
| `LEGAL_JURISDICTION` | The governing law clause, phrased to follow "the laws of"; also stamped on the report transcript |
| `SUPPORT_URL` | The titlebar coffee link. Unset keeps the upstream author's; any non-https value, `none` included, drops the button |
| `SITE_ORIGIN` | This deploy's origin, for canonical tags, the social image, and the sitemap |

Set these under **Build variables and secrets** in Workers Builds, not the runtime **Variables and Secrets** panel: Workers keeps the two separate and a build cannot read runtime vars. Locally, copy `.env.example` to `.env`.

A Vite plugin substitutes them at build time, so a changed value lands on the next build. Push to trigger one.

All four are optional. Contact and jurisdiction fall back to neutral wording. Without `SITE_ORIGIN` the pages drop what it would have filled: no canonical tags, no social image, no `sitemap.xml`. A fork that sets nothing ships a correct anonymous site.

## Reporting

The Report control under `More…` captures the transcript the reporter can see and navigates to `report.html` to render it for copying. It crosses in one session-storage entry that the report page deletes as it loads, so nothing reaches the server.

The page routes serious material to police or a national hotline, and to the host of anything linked. It names no agency, since the one that applies follows the reporter's country. It does name Cloudflare, so an investigator knows connection records come from the host. `LEGAL_CONTACT` covers the one case an operator can act on: closing a room.

## What a fork inherits

Nothing in the pages names an operator. Absolute URLs, `robots.txt`, and `sitemap.xml` are all built from `SITE_ORIGIN`, so a fork that sets it points at itself and a fork that does not ships neither.

The source link in section 1 of the terms points at this repository. The AGPL obliges a modified deployment to replace it with one reaching its own source.

The privacy policy's Traffic measurement section describes the Cloudflare Web Analytics beacon this deploy runs. Automatic setup injects it across every subdomain in a zone, so check whether yours does. A fork without it should delete that section.
