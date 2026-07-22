import { describe, expect, it } from "vitest";
import {
	annotationInBounds,
	CHAT_MODES,
	type ComicAnnotation,
	parseAnnotation,
	parseClientMessage,
} from "../src/protocol/room.js";

const annotation: ComicAnnotation = {
	faceIndex: 4,
	faceEmotionIndex: 7,
	faceIntensity: 0.8,
	torsoIndex: 7,
	torsoEmotionIndex: 7,
	torsoIntensity: 0.8,
	requested: true,
	talkTos: ["jerem"],
};

const chat = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		type: "chat",
		text: "hi",
		mode: 1,
		annotation,
		...overrides,
	});

describe("parseClientMessage annotation", () => {
	it("accepts a complete annotation for every chat mode", () => {
		for (const mode of CHAT_MODES)
			expect(parseClientMessage(chat({ mode }))).toEqual({
				type: "chat",
				text: "hi",
				mode,
				annotation,
			});
	});

	it("requires the annotation", () => {
		expect(parseClientMessage(chat({ annotation: undefined }))).toBeNull();
	});

	it("rejects the legacy pose property outright", () => {
		expect(
			parseClientMessage(chat({ pose: { expr: 4, gest: 7, req: 1 } })),
		).toBeNull();
	});

	it("rejects malformed annotations", () => {
		for (const broken of [
			{ ...annotation, faceIndex: -1 },
			{ ...annotation, faceIndex: 256 },
			{ ...annotation, faceIndex: 1.5 },
			{ ...annotation, faceEmotionIndex: 18 },
			{ ...annotation, faceIntensity: 0.85 },
			{ ...annotation, faceIntensity: 1.1 },
			{ ...annotation, faceIntensity: Number.NaN },
			{ ...annotation, torsoIntensity: -0.1 },
			{ ...annotation, requested: 1 },
			{ ...annotation, talkTos: "jerem" },
			{ ...annotation, talkTos: [7] },
			{ ...annotation, talkTos: [""] },
			{ ...annotation, talkTos: ["x".repeat(25)] },
			{ ...annotation, talkTos: ["a", "b", "c", "d", "e", "f"] },
			{ ...annotation, torsoIndex: undefined },
			"annotation",
			null,
		])
			expect(
				parseClientMessage(chat({ annotation: broken })),
				JSON.stringify(broken),
			).toBeNull();
	});

	it("dedupes addressees case-insensitively", () => {
		const parsed = parseAnnotation({
			...annotation,
			talkTos: ["Jerem", "jerem", "Anna"],
		});
		expect(parsed?.talkTos).toEqual(["Jerem", "Anna"]);
	});

	it("passes a valid sent stamp through and drops malformed ones", () => {
		expect(parseClientMessage(chat({ sent: 1234.9 }))).toMatchObject({
			sent: 1234,
		});
		for (const sent of [-5, 0, 0.5, Number.NaN, "now"])
			expect(parseClientMessage(chat({ sent }))).toEqual({
				type: "chat",
				text: "hi",
				mode: 1,
				annotation,
			});
	});

	it("still passes <Chr> reaction text", () => {
		expect(parseClientMessage(chat({ text: "<Chr>" }))).toMatchObject({
			text: "<Chr>",
		});
	});
});

describe("annotationInBounds", () => {
	it("bounds complex indexes by the avatar's record counts", () => {
		// anna (avatar 1) has 18 faces and 16 torsos
		expect(annotationInBounds({ ...annotation, faceIndex: 17 }, 1)).toBe(true);
		expect(annotationInBounds({ ...annotation, faceIndex: 18 }, 1)).toBe(false);
		expect(annotationInBounds({ ...annotation, torsoIndex: 16 }, 1)).toBe(
			false,
		);
	});

	it("accepts only the documented simple-avatar shape", () => {
		// connor (avatar 3) is simple with 15 bodies
		const simple: ComicAnnotation = {
			...annotation,
			faceIndex: 0,
			torsoIndex: 14,
			torsoEmotionIndex: 0,
			torsoIntensity: 0,
		};
		expect(annotationInBounds(simple, 3)).toBe(true);
		expect(annotationInBounds({ ...simple, faceIndex: 1 }, 3)).toBe(false);
		expect(annotationInBounds({ ...simple, torsoIndex: 15 }, 3)).toBe(false);
		expect(annotationInBounds({ ...simple, torsoEmotionIndex: 9 }, 3)).toBe(
			false,
		);
		expect(annotationInBounds({ ...simple, torsoIntensity: 0.5 }, 3)).toBe(
			false,
		);
	});

	it("rejects avatars outside the cast", () => {
		expect(annotationInBounds(annotation, 0)).toBe(false);
		expect(annotationInBounds(annotation, 99)).toBe(false);
	});
});
