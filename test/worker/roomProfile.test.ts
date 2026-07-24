import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { NAME_BLOCKED_REASON } from "../../src/protocol/room.js";
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
		expect(update.was).toMatchObject({ name: "bob", avatar: 2 });
		expect(update.who).toMatchObject({ name: "rob", avatar: 2 });
		expect(update.who.id).toBe(update.was.id);
		// the old nick announces the new one in the persisted stream
		const announce = await ann.inbox.next("entry");
		expect(announce.type === "entry" && announce.entry).toMatchObject({
			type: "announce",
			kind: "nick",
			name: "bob",
			detail: "rob",
		});
		const stub = env.CHAT_ROOM.getByName(room);
		const row = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ event_type: string; name: string; text: string }>(
					"SELECT event_type, name, text FROM events ORDER BY seq DESC LIMIT 1",
				)
				.one(),
		);
		expect(row).toEqual({ event_type: "nick", name: "bob", text: "rob" });
		ann.socket.close();
		bob.socket.close();
	});

	it("changes avatar, sharing a seat another user already holds", async () => {
		const room = "profile-avatar";
		const ann = await join(room, "ann", 1);
		const bob = await join(room, "bob", 2);
		// an unchanged profile echoes a no-op resnap instead of broadcasting
		bob.socket.send(
			JSON.stringify({ type: "profile", name: "bob", avatar: 2 }),
		);
		const echo = await bob.inbox.next("profile");
		if (echo.type !== "profile") throw new Error("expected a profile");
		expect(echo.who).toMatchObject({ name: "bob", avatar: 2 });
		// ann already wears avatar 1; bob gets it anyway
		bob.socket.send(
			JSON.stringify({ type: "profile", name: "bob", avatar: 1 }),
		);
		const update = await bob.inbox.next("profile");
		if (update.type !== "profile") throw new Error("expected a profile");
		expect(update.who).toMatchObject({ name: "bob", avatar: 1 });
		const announce = await ann.inbox.next("entry");
		expect(announce.type === "entry" && announce.entry).toMatchObject({
			type: "announce",
			kind: "avatar",
			avatar: 1,
			name: "bob",
			detail: "1",
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
		const gone = await ann.inbox.next("entry");
		expect(gone.type === "entry" && gone.entry).toMatchObject({
			type: "announce",
			kind: "depart",
			name: "bob",
			detail: "arrive",
		});
		bob.socket.close();

		const moved = await join("arrive", "bob", 2, origin);
		const arrived = await moved.inbox.next("entry");
		expect(arrived.type === "entry" && arrived.entry).toMatchObject({
			type: "announce",
			kind: "arrive",
			name: "bob",
			detail: origin,
		});
		// the arrival is persisted so latecomers replay it
		const stub = env.CHAT_ROOM.getByName("arrive");
		const row = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ event_type: string }>(
					"SELECT event_type FROM events ORDER BY seq DESC LIMIT 1",
				)
				.one(),
		);
		expect(row.event_type).toBe("arrive");
		ann.socket.close();
		moved.socket.close();
	});
});
