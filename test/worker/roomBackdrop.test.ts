import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chatMessage, join, seedLines } from "./helpers.js";

describe("room backdrop replay", () => {
	it("tags each row with the backdrop in effect when it landed", async () => {
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
		const tagged = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{
					event_type: string;
					text: string | null;
					background_name: string | null;
					bg: string;
				}>(
					"SELECT event_type, text, background_name, bg FROM events ORDER BY seq",
				)
				.toArray(),
		);
		expect(tagged).toEqual([
			{
				event_type: "chat",
				text: "before",
				background_name: null,
				bg: "field",
			},
			{
				event_type: "background",
				text: null,
				background_name: "volcano",
				bg: "volcano",
			},
			{
				event_type: "chat",
				text: "after",
				background_name: null,
				bg: "volcano",
			},
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
		// 60 lines on field, then the switch to den and a few more, so the background event falls outside the 50-entry chunk
		const room = "backdrop-chunk";
		await seedLines(room, 60, "field");
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
});
