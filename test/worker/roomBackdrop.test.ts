import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chatMessage, join, seedLines } from "./helpers.js";

describe("room backdrop replay", () => {
	it("records backdrop changes in the stream and seeds replay from them", async () => {
		const room = "backdrop-tags";
		const first = await join(room, "ann", 1);
		expect(first.welcome.historyBackground).toBe("field");

		first.socket.send(chatMessage("before", 1));
		await first.inbox.next("entry");
		first.socket.send(JSON.stringify({ type: "background", name: "volcano" }));
		await first.inbox.next("entry");
		first.socket.send(chatMessage("after", 1));
		await first.inbox.next("entry");

		const stub = env.CHAT_ROOM.getByName(room);
		const stream = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{
					event_type: string;
					text: string | null;
					background_name: string | null;
				}>("SELECT event_type, text, background_name FROM events ORDER BY seq")
				.toArray(),
		);
		expect(stream).toEqual([
			{ event_type: "chat", text: "before", background_name: null },
			{ event_type: "background", text: null, background_name: "volcano" },
			{ event_type: "chat", text: "after", background_name: null },
		]);

		// a later joiner replays from where the log started, not from where the room stands now
		const second = await join(room, "bob", 2);
		expect(second.welcome.type === "welcome" && second.welcome.background).toBe(
			"volcano",
		);
		expect(second.welcome.historyBackground).toBe("field");

		first.socket.close();
		second.socket.close();
	});

	it("seeds replay from the chunk's own backdrop when the change predates it", async () => {
		// 60 lines on the default, then the switch to den and a few more, so the background event falls outside the 50-entry chunk
		const room = "backdrop-chunk";
		await seedLines(room, 60);
		const author = await join(room, "cass", 3);
		author.socket.send(JSON.stringify({ type: "background", name: "den" }));
		await author.inbox.next("entry");
		for (const text of ["later 0", "later 1", "later 2"]) {
			author.socket.send(chatMessage(text, 3));
			await author.inbox.next("entry");
		}
		author.socket.close();

		const { socket, inbox, welcome } = await join(room, "dana", 4);
		expect(welcome.history).toHaveLength(50);
		const oldest = welcome.history[0];
		expect(oldest?.type === "chat" && oldest.text).toBe("line 14");
		// the room is on den now, but this chunk opens back on field
		expect(welcome.background).toBe("den");
		expect(welcome.historyBackground).toBe("field");

		// scrolling further back keeps its own seed rather than inheriting the newer one
		socket.send(
			JSON.stringify({ type: "history", before: welcome.history[0]?.seq }),
		);
		const older = await inbox.next("history");
		if (older.type !== "history") throw new Error("expected history");
		expect(older.background).toBe("field");

		socket.close();
	});

	it("spares the last old backdrop event from the prune so chunks keep their seed", async () => {
		const room = "backdrop-prune";
		const author = await join(room, "eve", 5);
		author.socket.send(JSON.stringify({ type: "background", name: "den" }));
		await author.inbox.next("entry");
		author.socket.close();
		await seedLines(room, 505);
		const late = await join(room, "finn", 6);
		late.socket.send(chatMessage("newest", 6));
		await late.inbox.next("entry");

		// the ancient den event survives retention as the window's horizon marker
		const stub = env.CHAT_ROOM.getByName(room);
		const summary = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ total: number; oldest_type: string }>(
					"SELECT COUNT(*) AS total, (SELECT event_type FROM events ORDER BY seq LIMIT 1) AS oldest_type FROM events",
				)
				.one(),
		);
		expect(summary).toEqual({ total: 501, oldest_type: "background" });

		const reader = await join(room, "gale", 7);
		expect(reader.welcome.historyBackground).toBe("den");
		late.socket.close();
		reader.socket.close();
	});
});
