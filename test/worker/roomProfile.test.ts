import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	ARRIVE_MODE,
	AVATAR_MODE,
	DEPART_MODE,
	NAME_BLOCKED_REASON,
	NICK_MODE,
} from "../../src/protocol/room.js";
import { join } from "./helpers.js";

describe("profile changes and room-switch announcements", () => {
	it("renames a seat, updates the roster, and persists the announcement", async () => {
		const room = "profile";
		const ann = await join(room, "ann", 1);
		const bob = await join(room, "bob", 2);
		bob.socket.send(
			JSON.stringify({ type: "profile", name: "rob", avatar: 2 }),
		);
		const update = await ann.inbox.next("profile");
		if (update.type !== "profile") throw new Error("expected a profile");
		expect(update.was).toEqual({ name: "bob", avatar: 2 });
		expect(update.who).toEqual({ name: "rob", avatar: 2 });
		// the old nick announces the new one in the persisted stream
		const announce = await ann.inbox.next("chat");
		expect(announce.type === "chat" && announce.entry).toMatchObject({
			name: "bob",
			text: "rob",
			mode: NICK_MODE,
		});
		const stub = env.CHAT_ROOM.getByName(room);
		const row = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ name: string; text: string; mode: number }>(
					"SELECT name, text, mode FROM messages ORDER BY seq DESC LIMIT 1",
				)
				.one(),
		);
		expect(row).toEqual({ name: "bob", text: "rob", mode: NICK_MODE });
		ann.socket.close();
		bob.socket.close();
	});

	it("changes avatar, echoing a no-op when the seat is taken", async () => {
		const room = "profile-avatar";
		const ann = await join(room, "ann", 1);
		const bob = await join(room, "bob", 2);
		// ann holds seat 1, so bob's request resolves back to his own seat
		bob.socket.send(
			JSON.stringify({ type: "profile", name: "bob", avatar: 1 }),
		);
		const echo = await bob.inbox.next("profile");
		if (echo.type !== "profile") throw new Error("expected a profile");
		expect(echo.who).toEqual({ name: "bob", avatar: 2 });
		bob.socket.send(
			JSON.stringify({ type: "profile", name: "bob", avatar: 4 }),
		);
		const update = await bob.inbox.next("profile");
		if (update.type !== "profile") throw new Error("expected a profile");
		expect(update.who).toEqual({ name: "bob", avatar: 4 });
		const announce = await ann.inbox.next("chat");
		expect(announce.type === "chat" && announce.entry).toMatchObject({
			avatar: 4,
			name: "bob",
			text: "4",
			mode: AVATAR_MODE,
		});
		ann.socket.close();
		bob.socket.close();
	});

	it("rejects a prohibited rename and keeps the seat", async () => {
		const room = "profile-block";
		const ann = await join(room, "ann", 1);
		ann.socket.send(
			JSON.stringify({ type: "profile", name: "fucker", avatar: 1 }),
		);
		const rejected = await ann.inbox.next("error");
		expect(rejected.type === "error" && rejected.reason).toBe(
			NAME_BLOCKED_REASON,
		);
		ann.socket.close();
	});

	it("announces departures and arrivals with their rooms", async () => {
		const origin = "depart";
		const ann = await join(origin, "ann", 1);
		const bob = await join(origin, "bob", 2);
		bob.socket.send(JSON.stringify({ type: "depart", to: "arrive" }));
		const gone = await ann.inbox.next("chat");
		expect(gone.type === "chat" && gone.entry).toMatchObject({
			name: "bob",
			text: "arrive",
			mode: DEPART_MODE,
		});
		bob.socket.close();

		const moved = await join("arrive", "bob", 2, origin);
		const arrived = await moved.inbox.next("chat");
		expect(arrived.type === "chat" && arrived.entry).toMatchObject({
			name: "bob",
			text: origin,
			mode: ARRIVE_MODE,
		});
		// the arrival is persisted so latecomers replay it
		const stub = env.CHAT_ROOM.getByName("arrive");
		const row = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ mode: number }>(
					"SELECT mode FROM messages ORDER BY seq DESC LIMIT 1",
				)
				.one(),
		);
		expect(row.mode).toBe(ARRIVE_MODE);
		ann.socket.close();
		moved.socket.close();
	});
});
