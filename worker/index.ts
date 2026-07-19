// Worker entry: routes room WebSockets to their Durable Object, everything else to static assets.

import { roomNameFromPath } from "../src/protocol/room.js";
import { RoomDirectoryDO } from "./directory.js";
import { ChatRoomDO } from "./room.js";

export { ChatRoomDO, RoomDirectoryDO };

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) {
			if (url.pathname === "/api/rooms")
				return Response.json({
					rooms: await env.ROOM_DIRECTORY.getByName("directory").list(),
				});
			const room = roomNameFromPath(url.pathname);
			if (!room) return Response.json({ error: "not found" }, { status: 404 });
			return env.CHAT_ROOM.getByName(room).fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
