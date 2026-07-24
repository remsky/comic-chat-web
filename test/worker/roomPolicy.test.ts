import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	MESSAGE_BLOCKED_REASON,
	NAME_BLOCKED_REASON,
	RATE_LIMIT_REASON,
} from "../../src/protocol/room.js";
import { chatMessage, connect, join, seedLines } from "./helpers.js";

describe("room policy", () => {
	it("drops sends past the burst and closes a sustained flood", async () => {
		const room = "flood";
		const { socket, inbox } = await join(room, "ann", 1);
		// the join itself spent one of the 5 burst tokens
		for (let index = 0; index < 4; index++) {
			socket.send(chatMessage(`burst ${index}`, 1));
			await inbox.next("entry");
		}
		socket.send(chatMessage("dropped", 1));
		const limited = await inbox.next("error");
		expect(limited.type === "error" && limited.reason).toBe(RATE_LIMIT_REASON);

		const stub = env.CHAT_ROOM.getByName(room);
		const rows = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ text: string }>("SELECT text FROM events ORDER BY seq")
				.toArray(),
		);
		expect(rows.map((row) => row.text)).toEqual([
			"burst 0",
			"burst 1",
			"burst 2",
			"burst 3",
		]);

		const closed = new Promise<{ code: number; reason: string }>((resolve) =>
			socket.addEventListener("close", (event) =>
				resolve({ code: event.code, reason: event.reason }),
			),
		);
		// 30 back-to-back sends comfortably clears the 20-strike close threshold
		for (let index = 0; index < 30; index++) {
			try {
				socket.send(chatMessage("flood", 1));
			} catch {
				break;
			}
		}
		const close = await closed;
		expect(close.code).toBe(1008);
		expect(close.reason).toBe(RATE_LIMIT_REASON);
	});

	it("mutes a blocked message and keeps it out of the log", async () => {
		const room = "mute";
		const { socket, inbox } = await join(room, "bob", 2);
		socket.send(chatMessage("fuck this", 2));
		const blocked = await inbox.next("error");
		expect(blocked.type === "error" && blocked.reason).toBe(
			MESSAGE_BLOCKED_REASON,
		);
		expect(blocked.type === "error" && blocked.retryAfter).toBe(15_000);

		// the mute outlasts the offense, so even a clean line bounces with the remaining wait
		socket.send(chatMessage("sorry", 2));
		const muted = await inbox.next("error");
		expect(muted.type === "error" && muted.reason).toBe(MESSAGE_BLOCKED_REASON);
		if (muted.type !== "error") throw new Error("expected an error");
		expect(muted.retryAfter).toBeGreaterThan(0);
		expect(muted.retryAfter).toBeLessThanOrEqual(15_000);

		const stub = env.CHAT_ROOM.getByName(room);
		const count = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ total: number }>("SELECT COUNT(*) AS total FROM events")
				.one(),
		);
		expect(count.total).toBe(0);
		socket.close();
	});

	it("rejects a prohibited nickname at join", async () => {
		const { socket, inbox } = await connect("name-block");
		socket.send(JSON.stringify({ type: "join", name: "fucker", avatar: 3 }));
		const rejected = await inbox.next("error");
		expect(rejected.type === "error" && rejected.reason).toBe(
			NAME_BLOCKED_REASON,
		);
		socket.close();
	});

	it("prunes history beyond the 500-row retention", async () => {
		const room = "retention";
		await seedLines(room, 505);
		const { socket, inbox } = await join(room, "cass", 3);
		socket.send(chatMessage("newest", 3));
		await inbox.next("entry");

		const stub = env.CHAT_ROOM.getByName(room);
		const summary = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ total: number; oldest: string }>(
					"SELECT COUNT(*) AS total, (SELECT text FROM events ORDER BY seq LIMIT 1) AS oldest FROM events",
				)
				.one(),
		);
		expect(summary.total).toBe(500);
		expect(summary.oldest).toBe("line 6");
		socket.close();
	});

	it("broadcasts joins and leaves and lets seats share an avatar", async () => {
		const room = "roster";
		const ann = await join(room, "ann", 1);
		expect(ann.welcome.roster).toMatchObject([{ name: "ann", avatar: 1 }]);

		// bob asks for ann's avatar and gets it; the id tells the seats apart
		const bob = await join(room, "bob", 1);
		expect(bob.welcome.avatar).toBe(1);
		expect(bob.welcome.id).not.toBe(ann.welcome.id);
		expect(bob.welcome.roster).toHaveLength(2);
		expect(bob.welcome.roster).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "ann", avatar: 1 }),
				expect.objectContaining({ name: "bob", avatar: 1 }),
			]),
		);

		// the join broadcast reaches every seated socket, the joiner's own included
		const echo = await ann.inbox.next("joined");
		expect(echo.type === "joined" && echo.who).toMatchObject({
			name: "ann",
			avatar: 1,
		});
		const joined = await ann.inbox.next("joined");
		expect(joined.type === "joined" && joined.who).toMatchObject({
			name: "bob",
			avatar: 1,
		});
		bob.socket.close();
		const left = await ann.inbox.next("left");
		expect(left.type === "left" && left.who).toMatchObject({
			name: "bob",
			avatar: 1,
		});
		expect(left.type === "left" && left.who.id).toBe(bob.welcome.id);
		ann.socket.close();
	});

	it("refuses a 13th socket", async () => {
		const room = "socket-cap";
		const sockets: WebSocket[] = [];
		for (let index = 0; index < 12; index++)
			sockets.push((await connect(room)).socket);
		const response = await SELF.fetch(
			`https://comic.test/api/rooms/${room}/websocket`,
			{ headers: { Upgrade: "websocket" } },
		);
		expect(response.status).toBe(503);
		for (const socket of sockets) socket.close();
	});
});
