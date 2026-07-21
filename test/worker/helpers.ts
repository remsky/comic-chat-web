import { env, runInDurableObject, SELF } from "cloudflare:test";
import type { ServerMessage } from "../../src/protocol/room.js";

export interface Inbox {
	next(type: ServerMessage["type"]): Promise<ServerMessage>;
}

// one room per test (allowlisted in vitest.config.ts): a shared DO's sockets outlive the test that opened them
export async function connect(
	room: string,
): Promise<{ socket: WebSocket; inbox: Inbox }> {
	const response = await SELF.fetch(
		`https://comic.test/api/rooms/${room}/websocket`,
		{ headers: { Upgrade: "websocket" } },
	);
	const socket = response.webSocket;
	if (!socket) throw new Error("room did not upgrade the connection");
	socket.accept();
	const queue: ServerMessage[] = [];
	const waiters: (() => void)[] = [];
	socket.addEventListener("message", (event) => {
		queue.push(JSON.parse(event.data as string) as ServerMessage);
		waiters.shift()?.();
	});
	// the stream interleaves joined/left broadcasts, so pull until the wanted frame surfaces
	const next = async (type: ServerMessage["type"]): Promise<ServerMessage> => {
		for (;;) {
			const index = queue.findIndex((message) => message.type === type);
			if (index >= 0) return queue.splice(index, 1)[0] as ServerMessage;
			await new Promise<void>((resolve) => waiters.push(resolve));
		}
	};
	return { socket, inbox: { next } };
}

export async function join(room: string, name: string, avatar: number) {
	const { socket, inbox } = await connect(room);
	socket.send(JSON.stringify({ type: "join", name, avatar }));
	const welcome = await inbox.next("welcome");
	if (welcome.type !== "welcome") throw new Error("expected a welcome");
	return { socket, inbox, welcome };
}

// backfills old lines straight through SQL: the rate limit makes a >50-entry log unsendable over the wire
export async function seedLines(
	room: string,
	count: number,
	bg: string,
): Promise<void> {
	const stub = env.CHAT_ROOM.getByName(room);
	await runInDurableObject(stub, (_instance, state) => {
		for (let index = 0; index < count; index++)
			state.storage.sql.exec(
				"INSERT INTO messages (avatar, name, text, mode, at, expr, gest, req, bg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				1,
				"seed",
				`line ${index}`,
				1,
				Date.now(),
				null,
				null,
				null,
				bg,
			);
	});
}
