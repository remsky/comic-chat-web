// Worker entry: routes room WebSockets to their Durable Object, everything else to static assets.

import { roomNameFromPath } from "../src/protocol/room.js";
import { ChatRoomDO } from "./room.js";

export { ChatRoomDO };

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) {
			const room = roomNameFromPath(url.pathname);
			if (!room) return Response.json({ error: "not found" }, { status: 404 });
			return env.CHAT_ROOM.getByName(room).fetch(request);
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
