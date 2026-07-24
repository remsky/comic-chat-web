import { describe, expect, it } from "vitest";
import type { ComicAnnotation } from "../../src/protocol/room.js";
import { annotationFor, join } from "./helpers.js";

describe("chat annotations", () => {
	it("persists and hydrates every annotation field exactly", async () => {
		const room = "annotation-trip";
		const ann = await join(room, "ann", 1);
		const bob = await join(room, "bob", 2);
		const annotation: ComicAnnotation = {
			faceIndex: 4,
			faceEmotionIndex: 7,
			faceIntensity: 0.8,
			torsoIndex: 3,
			torsoEmotionIndex: 6,
			torsoIntensity: 0.3,
			requested: true,
			talkTos: ["bob"],
		};
		ann.socket.send(
			JSON.stringify({ type: "chat", text: "hi bob", mode: 2, annotation }),
		);
		const live = await bob.inbox.next("entry");
		expect(live.type === "entry" && live.entry).toEqual({
			type: "chat",
			seq: 1,
			userId: "u-ann",
			avatar: 1,
			name: "ann",
			text: "hi bob",
			mode: 2,
			annotation,
		});
		// a fresh join replays the same annotation from storage
		const cass = await join(room, "cass", 3);
		const replayed = cass.welcome.history.find(
			(entry) => entry.type === "chat" && entry.text === "hi bob",
		);
		expect(replayed?.type === "chat" && replayed.annotation).toEqual(
			annotation,
		);
		ann.socket.close();
		bob.socket.close();
		cass.socket.close();
	});

	it("rejects annotations out of bounds for the seat's avatar", async () => {
		const room = "annotation-bounds";
		const { socket, inbox } = await join(room, "ann", 1);
		// anna has 18 faces; index 40 cannot render
		socket.send(
			JSON.stringify({
				type: "chat",
				text: "nope",
				mode: 1,
				annotation: { ...annotationFor(1), faceIndex: 40 },
			}),
		);
		const rejected = await inbox.next("error");
		expect(rejected.type === "error" && rejected.reason).toBe(
			"malformed message",
		);
		socket.close();
	});
});
