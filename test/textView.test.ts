import { describe, expect, it } from "vitest";
import { transcriptHeader, transcriptLine } from "../src/browser/textView.js";
import type {
	AnnounceKind,
	ChatMode,
	ComicAnnotation,
} from "../src/protocol/room.js";

const annotation: ComicAnnotation = {
	faceIndex: 0,
	faceEmotionIndex: 9,
	faceIntensity: 0,
	torsoIndex: 0,
	torsoEmotionIndex: 9,
	torsoIntensity: 0,
	requested: false,
	talkTos: [],
};

const chat = (mode: ChatMode, text: string) => ({
	type: "chat" as const,
	seq: 1,
	avatar: 1,
	name: "Anna",
	text,
	mode,
	annotation,
});

const announce = (kind: AnnounceKind, detail: string) => ({
	type: "announce" as const,
	kind,
	seq: 1,
	avatar: 1,
	name: "Anna",
	detail,
});

describe("plain-text view formatting", () => {
	it("maps balloon modes to the original text-view headers", () => {
		const say = transcriptLine(chat(1, "hi"));
		expect(say).toEqual({ kind: "say", name: "Anna", body: "hi" });
		expect(transcriptHeader(say as NonNullable<typeof say>)).toBe("Anna");

		const think = transcriptLine(chat(3, "hmm"));
		expect(think?.kind).toBe("think");
		expect(transcriptHeader(think as NonNullable<typeof think>)).toBe(
			"Anna thinks:",
		);

		const whisper = transcriptLine(chat(2, "psst"));
		expect(whisper?.kind).toBe("whisper");
		expect(transcriptHeader(whisper as NonNullable<typeof whisper>)).toBe(
			"Anna whispers:",
		);

		expect(transcriptLine(chat(5, "waves"))?.kind).toBe("action");
	});

	it("renders announcements as system lines", () => {
		expect(transcriptLine(announce("nick", "Beatrice"))).toEqual({
			kind: "system",
			name: "Anna",
			body: "is now Beatrice",
		});
		expect(
			transcriptLine(announce("avatar", "3"), (id) => `Avatar${id}`),
		).toEqual({
			kind: "system",
			name: "Anna",
			body: "changed avatar to Avatar3",
		});
		expect(transcriptLine(announce("avatar", "3"))?.body).toBe(
			"changed avatar to 3",
		);
		expect(transcriptLine(announce("depart", "lobby"))?.body).toBe(
			"left and went to lobby",
		);
		expect(transcriptLine(announce("arrive", "lobby"))?.body).toBe(
			"is back from lobby",
		);
	});

	it("skips <Chr> pose lines and renders background changes as system lines", () => {
		expect(transcriptLine(chat(1, "<Chr>"))).toBeNull();
		expect(
			transcriptLine({ type: "background", seq: 1, name: "space", by: "Anna" }),
		).toEqual({
			kind: "system",
			name: "Anna",
			body: "set the background to space",
		});
		expect(
			transcriptLine({ type: "background", seq: 1, name: "", by: "Anna" })
				?.body,
		).toBe("set the background to none");
	});
});
