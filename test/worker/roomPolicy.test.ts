import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	MESSAGE_BLOCKED_REASON,
	NAME_BLOCKED_REASON,
	RATE_LIMIT_REASON,
} from "../../src/protocol/room.js";
import { HISTORY_RETENTION } from "../../worker/db/events.js";
import {
	FLOOD_CLOSE_STRIKES,
	MOD_CLOSE_STRIKES,
	MUTE_STEP_MS,
	RATE_BURST,
} from "../../worker/room.js";
import { chatMessage, connect, join, seedLines } from "./helpers.js";

// policy state rides on the socket attachment, so rewriting it walks the socket to a given standing without a real wait
async function patchSocketState(
	room: string,
	patch: Record<string, unknown>,
): Promise<void> {
	const stub = env.CHAT_ROOM.getByName(room);
	await runInDurableObject(stub, (_instance, state) => {
		for (const ws of state.getWebSockets()) {
			const attached = ws.deserializeAttachment() as Record<string, unknown>;
			ws.serializeAttachment({ ...attached, ...patch });
		}
	});
}

// the bucket refills by wall clock, and the worker floors elapsed at zero; a stamp in the future holds it still for the next send, so the token count is the code's arithmetic and not the runner's speed
const REFILL_HOLD_MS = 60_000;
const holdRefill = (room: string) =>
	patchSocketState(room, { at: Date.now() + REFILL_HOLD_MS });

const primeStrikes = (room: string, strikes: number) =>
	patchSocketState(room, {
		tokens: 0,
		at: Date.now() + REFILL_HOLD_MS,
		strikes,
	});

const skipCooldowns = (room: string) =>
	patchSocketState(room, {
		mutedUntil: 0,
		tokens: RATE_BURST,
		at: Date.now(),
	});

async function strikesOf(room: string): Promise<number> {
	const stub = env.CHAT_ROOM.getByName(room);
	return await runInDurableObject(stub, (_instance, state) => {
		const [ws] = state.getWebSockets();
		if (!ws) throw new Error("expected an attached socket");
		const attached = ws.deserializeAttachment() as { strikes?: number };
		return attached.strikes ?? 0;
	});
}

describe("room policy", () => {
	it("drops sends past the burst and closes a sustained flood", async () => {
		const room = "flood";
		const { socket, inbox } = await join(room, "ann", 1);
		await holdRefill(room);
		// the join spent one token; the rest of the burst goes to chat and leaves the bucket dry
		const burst = Array.from(
			{ length: RATE_BURST - 1 },
			(_, index) => `burst ${index}`,
		);
		for (const text of burst) {
			socket.send(chatMessage(text, 1));
			await inbox.next("entry");
			await holdRefill(room);
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
		expect(rows.map((row) => row.text)).toEqual(burst);

		// consecutive drops stack, and an allowed send would zero the count instead
		expect(await strikesOf(room)).toBe(1);
		await holdRefill(room);
		socket.send(chatMessage("dropped again", 1));
		await inbox.next("error");
		expect(await strikesOf(room)).toBe(2);

		const closed = new Promise<{ code: number; reason: string }>((resolve) =>
			socket.addEventListener("close", (event) =>
				resolve({ code: event.code, reason: event.reason }),
			),
		);
		// the ceiling is many more drops away, so jump to it rather than sending that many
		await primeStrikes(room, FLOOD_CLOSE_STRIKES - 1);
		socket.send(chatMessage("flood", 1));
		const close = await closed;
		expect(close.code).toBe(1008);
		expect(close.reason).toBe(RATE_LIMIT_REASON);
	});

	it("mutes a blocked message and keeps it out of the log", async () => {
		const room = "mute";
		const { socket, inbox } = await join(room, "bob", 2);
		socket.send(chatMessage("4rse this", 2));
		const blocked = await inbox.next("error");
		expect(blocked.type === "error" && blocked.reason).toBe(
			MESSAGE_BLOCKED_REASON,
		);
		expect(blocked.type === "error" && blocked.retryAfter).toBe(MUTE_STEP_MS);

		// the mute outlasts the offense, so even a clean line bounces with the remaining wait
		socket.send(chatMessage("sorry", 2));
		const muted = await inbox.next("error");
		expect(muted.type === "error" && muted.reason).toBe(MESSAGE_BLOCKED_REASON);
		if (muted.type !== "error") throw new Error("expected an error");
		expect(muted.retryAfter).toBeGreaterThan(0);
		expect(muted.retryAfter).toBeLessThanOrEqual(MUTE_STEP_MS);

		const stub = env.CHAT_ROOM.getByName(room);
		const count = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ total: number }>("SELECT COUNT(*) AS total FROM events")
				.one(),
		);
		expect(count.total).toBe(0);
		socket.close();
	});

	it("stretches the mute with every strike, then closes at the ceiling", async () => {
		const room = "mute-escalate";
		const { socket, inbox } = await join(room, "cal", 3);
		const closed = new Promise<{ code: number; reason: string }>((resolve) =>
			socket.addEventListener("close", (event) =>
				resolve({ code: event.code, reason: event.reason }),
			),
		);
		// every strike below the ceiling stretches the mute by another step; the one at the ceiling is shown the door instead
		for (let strike = 1; strike < MOD_CLOSE_STRIKES; strike++) {
			socket.send(chatMessage("4rse this", 3));
			const blocked = await inbox.next("error");
			expect(blocked.type === "error" && blocked.reason).toBe(
				MESSAGE_BLOCKED_REASON,
			);
			expect(blocked.type === "error" && blocked.retryAfter).toBe(
				strike * MUTE_STEP_MS,
			);
			await skipCooldowns(room);
		}
		socket.send(chatMessage("4rse this", 3));
		const close = await closed;
		expect(close.code).toBe(1008);
		expect(close.reason).toBe(MESSAGE_BLOCKED_REASON);
	});

	it("lets a clean line through once the mute runs out", async () => {
		const room = "mute-expire";
		const { socket, inbox } = await join(room, "dee", 4);
		socket.send(chatMessage("4rs3", 4));
		await inbox.next("error");
		await skipCooldowns(room);

		socket.send(chatMessage("sorry about that", 4));
		const entry = await inbox.next("entry");
		if (entry.type !== "entry" || entry.entry.type !== "chat")
			throw new Error("expected a chat entry");
		expect(entry.entry.text).toBe("sorry about that");
		socket.close();
	});

	it("lets the same line through when the deploy turned moderation off", async () => {
		const room = "mute-off";
		const was = env.MODERATION;
		env.MODERATION = "off" as typeof was;
		try {
			const { socket, inbox } = await join(room, "bob", 2);
			socket.send(chatMessage("4rse this", 2));
			const entry = await inbox.next("entry");
			if (entry.type !== "entry" || !("text" in entry.entry))
				throw new Error("expected a chat entry");
			expect(entry.entry.text).toBe("4rse this");
			socket.close();
		} finally {
			env.MODERATION = was;
		}
	});

	it("rejects a prohibited nickname at join", async () => {
		const { socket, inbox } = await connect("name-block");
		socket.send(JSON.stringify({ type: "join", name: "4rseface", avatar: 3 }));
		const rejected = await inbox.next("error");
		expect(rejected.type === "error" && rejected.reason).toBe(
			NAME_BLOCKED_REASON,
		);
		socket.close();
	});

	it("prunes history beyond the retention window", async () => {
		const room = "retention";
		// one past the window plus the live send, so the oldest survivor is a seeded line
		const seeded = HISTORY_RETENTION + 5;
		await seedLines(room, seeded);
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
		expect(summary.total).toBe(HISTORY_RETENTION);
		// seq n holds "line n-1", and the live send lands at seq seeded+1
		expect(summary.oldest).toBe(`line ${seeded + 1 - HISTORY_RETENTION}`);
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
