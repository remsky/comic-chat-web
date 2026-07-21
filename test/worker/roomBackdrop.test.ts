import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { join, seedLines } from "./helpers.js";

describe("room backdrop replay", () => {
	it("tags each row with the backdrop in effect when it landed", async () => {
		const room = "backdrop-tags";
		const first = await join(room, "ann", 1);
		expect(first.welcome.historyBackground).toBe("field");

		first.socket.send(
			JSON.stringify({ type: "chat", text: "before", mode: 1 }),
		);
		await first.inbox.next("chat");
		first.socket.send(JSON.stringify({ type: "background", name: "volcano" }));
		await first.inbox.next("chat");
		first.socket.send(JSON.stringify({ type: "chat", text: "after", mode: 1 }));
		await first.inbox.next("chat");

		const stub = env.CHAT_ROOM.getByName(room);
		const tagged = await runInDurableObject(stub, (_instance, state) =>
			state.storage.sql
				.exec<{ text: string; bg: string }>(
					"SELECT text, bg FROM messages ORDER BY seq",
				)
				.toArray(),
		);
		expect(tagged).toEqual([
			{ text: "before", bg: "field" },
			{ text: "volcano", bg: "volcano" },
			{ text: "after", bg: "volcano" },
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
		// 60 lines on field, then the switch to den and a few more, so the mode-6 falls outside the 50-entry chunk
		const room = "backdrop-chunk";
		await seedLines(room, 60, "field");
		const author = await join(room, "cass", 3);
		author.socket.send(JSON.stringify({ type: "background", name: "den" }));
		await author.inbox.next("chat");
		for (const text of ["later 0", "later 1", "later 2"]) {
			author.socket.send(JSON.stringify({ type: "chat", text, mode: 1 }));
			await author.inbox.next("chat");
		}
		author.socket.close();

		const { socket, inbox, welcome } = await join(room, "dana", 4);
		expect(welcome.history).toHaveLength(50);
		expect(welcome.history[0]?.text).toBe("line 14");
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
