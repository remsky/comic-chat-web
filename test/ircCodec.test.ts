import { describe, expect, it } from "vitest";
import {
	decodeIrcAnnotation,
	encodeIrcAnnotation,
} from "../src/protocol/ircCodec.js";
import type { ComicAnnotation } from "../src/protocol/room.js";

const annotation = (
	overrides: Partial<ComicAnnotation> = {},
): ComicAnnotation => ({
	faceIndex: 3,
	faceEmotionIndex: 7,
	faceIntensity: 0.8,
	torsoIndex: 2,
	torsoEmotionIndex: 7,
	torsoIntensity: 0.8,
	requested: false,
	talkTos: [],
	...overrides,
});

describe("authentic IRC annotation codec", () => {
	it("encodes the G/E/R/M/T layout byte for byte", () => {
		// sprintf("%s#%c%c%c%c%c%c%c%c%s%c%c", ...) with '0'-based bytes (protsupp.cpp:3048-3053)
		expect(
			encodeIrcAnnotation(
				1,
				annotation({ requested: true, talkTos: ["jerem"] }),
				"Hello there",
			),
		).toBe("(#G278E378RM1Tjerem) Hello there");
		expect(encodeIrcAnnotation(3, annotation(), "hmm")).toBe(
			"(#G278E378M3) hmm",
		);
	});

	it("encodes upper byte values as printable characters past '9'", () => {
		// emotion index 17 -> '0'+17 = 'A'; intensity 10 -> ':' (avatario.cpp:69-81)
		const wave = annotation({
			faceEmotionIndex: 17,
			faceIntensity: 1,
			torsoEmotionIndex: 10,
			torsoIntensity: 1,
		});
		expect(encodeIrcAnnotation(5, wave, "waves")).toBe("(#G2::E3A:M5) waves");
	});

	it("round-trips every chat mode with and without R and T", () => {
		for (const mode of [1, 2, 3, 5] as const) {
			for (const extras of [
				{},
				{ requested: true },
				{ talkTos: ["ann", "bob"] },
				{ requested: true, talkTos: ["ann"] },
			]) {
				const sent = annotation(extras);
				const decoded = decodeIrcAnnotation(
					encodeIrcAnnotation(mode, sent, "the text) tail"),
				);
				expect(decoded?.mode).toBe(mode);
				expect(decoded?.annotation).toEqual(sent);
				expect(decoded?.text).toBe("the text) tail");
			}
		}
	});

	it("truncates intensities to wire tenths", () => {
		const decoded = decodeIrcAnnotation(
			encodeIrcAnnotation(
				1,
				annotation({ faceIntensity: 0.698, torsoIntensity: 0.25 }),
				"x",
			),
		);
		expect(decoded?.annotation.faceIntensity).toBe(0.6);
		expect(decoded?.annotation.torsoIntensity).toBe(0.2);
	});

	it("decodes a comma-separated addressee list", () => {
		const decoded = decodeIrcAnnotation("(#G000E090M1Tann,bob) hi both");
		expect(decoded?.annotation.talkTos).toEqual(["ann", "bob"]);
		expect(decoded?.text).toBe("hi both");
	});

	it("rejects plain and malformed messages", () => {
		expect(decodeIrcAnnotation("just a message")).toBeNull();
		expect(decodeIrcAnnotation("(#G27")).toBeNull();
		expect(decodeIrcAnnotation("(#G278E378) missing mode")).toBeNull();
		expect(decodeIrcAnnotation("(#X278M1) unknown section")).toBeNull();
		expect(decodeIrcAnnotation("(#G278E378M4) shout is never sent")).toBeNull();
	});
});
