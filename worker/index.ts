// Worker entry: routes room WebSockets to their Durable Object, everything else to static assets.

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
	type RoomListing,
	resolveRoomAllowlist,
	roomNameFromPath,
} from "../src/protocol/room.js";
import { RoomDirectoryDO } from "./directory.js";
import { createStudioServer } from "./mcp/server.js";
import { isProhibited, screeningEnabled } from "./moderation.js";
import { stripSvgResponse } from "./render/stripSvg.js";
import { ChatRoomDO } from "./room.js";
import { SHORT_LINK_PATH, shortLinkResponse } from "./shortlink.js";

export { ChatRoomDO, RoomDirectoryDO };

const MAX_SCREEN_TEXTS = 200;
const MAX_SCREEN_CHARS = 2000;
const MAX_MCP_BODY = 256 * 1024;

// the studio's profanity screen; the wordlist stays here so it never ships to a browser
async function moderate(request: Request, env: Env): Promise<Response> {
	// a deploy that turned the screen off has no such route to offer
	if (!screeningEnabled(env))
		return Response.json({ error: "moderation is off" }, { status: 404 });
	if (request.method !== "POST")
		return Response.json({ error: "method not allowed" }, { status: 405 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid json" }, { status: 400 });
	}
	const texts = (body as { texts?: unknown }).texts;
	if (!Array.isArray(texts))
		return Response.json({ error: "texts must be an array" }, { status: 400 });
	if (texts.length > MAX_SCREEN_TEXTS)
		return Response.json({ error: "too many texts" }, { status: 413 });
	const flagged: number[] = [];
	texts.forEach((text, index) => {
		if (typeof text !== "string") return;
		if (isProhibited(text.slice(0, MAX_SCREEN_CHARS))) flagged.push(index);
	});
	return Response.json({ flagged });
}

// the connect screen's room list: every allowed room, always shown, annotated with live member counts
async function roomDirectory(
	env: Env,
	allowed: string[],
): Promise<RoomListing[]> {
	const live = new Map<string, RoomListing>();
	for (const listing of await env.ROOM_DIRECTORY.getByName("directory").list())
		live.set(listing.name, listing);
	return allowed.map(
		(name) => live.get(name) ?? { name, members: 0, active: 0 },
	);
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/studio/strip.svg")
			return stripSvgResponse(request, env.ASSETS);
		if (url.pathname.startsWith(SHORT_LINK_PATH))
			return shortLinkResponse(request, env.SHORTLINKS);
		if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
			if (Number(request.headers.get("content-length")) > MAX_MCP_BODY)
				return Response.json({ error: "request too large" }, { status: 413 });
			const mcp = createMcpHandler(() =>
				createStudioServer({
					assets: env.ASSETS,
					base: url.origin,
					shortLinks: env.SHORTLINKS,
					// a missing or malformed cap fails closed
					cap: Number(env.SHORTLINK_CAP) || 0,
					...(screeningEnabled(env) ? { prohibited: isProhibited } : {}),
				}),
			);
			return mcp.fetch(request);
		}
		if (url.pathname.startsWith("/api/")) {
			if (url.pathname === "/api/moderate") return moderate(request, env);
			const allowed = resolveRoomAllowlist(env.ROOMS);
			if (url.pathname === "/api/rooms")
				return Response.json({ rooms: await roomDirectory(env, allowed) });
			const room = roomNameFromPath(url.pathname);
			if (!room) return Response.json({ error: "not found" }, { status: 404 });
			// reject unknown rooms before touching a DO: the bound that keeps a public deploy finite
			if (!allowed.includes(room))
				return Response.json({ error: "unknown room" }, { status: 403 });
			return env.CHAT_ROOM.getByName(room).fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
