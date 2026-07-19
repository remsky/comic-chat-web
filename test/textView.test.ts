import { describe, expect, it } from "vitest";
import { transcriptHeader, transcriptLine } from "../src/browser/textView.js";

const entry = (mode: number, text: string) => ({
	seq: 1,
	avatar: 1,
	name: "Anna",
	text,
	mode,
});

describe("plain-text view formatting", () => {
	it("maps balloon modes to the original text-view headers", () => {
		const say = transcriptLine(entry(1, "hi"));
		expect(say).toEqual({ kind: "say", name: "Anna", body: "hi" });
		expect(transcriptHeader(say as NonNullable<typeof say>)).toBe("Anna");

		const think = transcriptLine(entry(3, "hmm"));
		expect(think?.kind).toBe("think");
		expect(transcriptHeader(think as NonNullable<typeof think>)).toBe(
			"Anna thinks:",
		);

		const whisper = transcriptLine(entry(2, "psst"));
		expect(whisper?.kind).toBe("whisper");
		expect(transcriptHeader(whisper as NonNullable<typeof whisper>)).toBe(
			"Anna whispers:",
		);

		expect(transcriptLine(entry(5, "waves"))?.kind).toBe("action");
	});

	it("skips <Chr> pose lines and renders background changes as system lines", () => {
		expect(transcriptLine(entry(1, "<Chr>"))).toBeNull();
		expect(transcriptLine(entry(6, "space"))).toEqual({
			kind: "system",
			name: "Anna",
			body: "set the background to space",
		});
		expect(transcriptLine(entry(6, ""))?.body).toBe(
			"set the background to none",
		);
	});
});
