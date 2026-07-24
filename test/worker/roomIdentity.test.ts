import { describe, expect, it } from "vitest";
import { chatMessage, connect, join } from "./helpers.js";

describe("stable user identity", () => {
	it("stamps history with the sender's userId and replays it", async () => {
		const room = "identity-replay";
		const ann = await join(room, "ann", 1);
		ann.socket.send(chatMessage("hi", 1));
		await ann.inbox.next("entry");

		const cass = await join(room, "cass", 3);
		const replayed = cass.welcome.history.find(
			(entry) => entry.type === "chat" && entry.text === "hi",
		);
		expect(replayed?.type === "chat" && replayed.userId).toBe("u-ann");
		ann.socket.close();
		cass.socket.close();
	});

	it("treats two connections sharing a userId as distinct seats of one person", async () => {
		const room = "identity-tabs";
		const first = await join(room, "ann", 1, undefined, "shared");
		const second = await join(room, "ann", 2, undefined, "shared");
		// one person, two seats: the userId matches, the connection id does not
		expect(second.welcome.userId).toBe("shared");
		expect(first.welcome.userId).toBe("shared");
		expect(second.welcome.id).not.toBe(first.welcome.id);
		expect(second.welcome.roster).toHaveLength(2);
		expect(
			second.welcome.roster.every((seat) => seat.userId === "shared"),
		).toBe(true);
		first.socket.close();
		second.socket.close();
	});

	it("mints a fallback identity when the client claims none", async () => {
		const room = "identity-fallback";
		const { socket, inbox } = await connect(room);
		socket.send(JSON.stringify({ type: "join", name: "ann", avatar: 1 }));
		const welcome = await inbox.next("welcome");
		if (welcome.type !== "welcome") throw new Error("expected a welcome");
		expect(welcome.userId.length).toBeGreaterThan(0);
		socket.close();
	});
});
