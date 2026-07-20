// Worker entry: routes room WebSockets to their Durable Object, everything else to static assets.

import {
	type RoomListing,
	resolveRoomAllowlist,
	roomNameFromPath,
} from "../src/protocol/room.js";
import { RoomDirectoryDO } from "./directory.js";
import { ChatRoomDO } from "./room.js";

export { ChatRoomDO, RoomDirectoryDO };

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
		if (url.pathname.startsWith("/api/")) {
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
