import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTexts, StripScreen } from "../src/studio/moderation.js";
import type { Strip } from "../src/studio/script.js";

function strip(title?: string, starring?: string): Strip {
	return {
		version: 1,
		panels: [
			{
				kind: "title",
				...(title ? { title } : {}),
				...(starring ? { starring } : {}),
				actors: [{ avatar: "anna", text: "The Boss" }],
			},
		],
	};
}

function screenAnswering(flaggedTexts: string[]): StripScreen {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: { body: string }) => {
			const { texts } = JSON.parse(init.body) as { texts: string[] };
			const flagged = texts.flatMap((text, index) =>
				flaggedTexts.includes(text) ? [index] : [],
			);
			return { ok: true, json: async () => ({ flagged }) };
		}),
	);
	return new StripScreen();
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("strip screen titles", () => {
	it("collects the title alongside actor text", () => {
		expect(
			collectTexts(strip("NO EXIT", "TOLD BY")).map((entry) => entry.path),
		).toEqual(["panels[0].title", "panels[0].starring", "panels[0].actors[0]"]);
	});

	it("holds a flagged title out of the drawable strip and reports it", async () => {
		const screen = screenAnswering(["BAD TITLE"]);
		const flagged = strip("BAD TITLE");
		await screen.update(flagged);
		expect(screen.drawable(flagged).panels[0]?.title).toBeUndefined();
		expect(screen.issues(flagged).map((issue) => issue.path)).toEqual([
			"panels[0].title",
		]);
	});

	it("draws a cleared title verbatim", async () => {
		const screen = screenAnswering([]);
		const cleared = strip("NO EXIT", "TOLD BY");
		await screen.update(cleared);
		expect(screen.drawable(cleared).panels[0]?.title).toBe("NO EXIT");
		expect(screen.drawable(cleared).panels[0]?.starring).toBe("TOLD BY");
		expect(screen.issues(cleared)).toEqual([]);
	});

	// the subhead is typed too, so it goes past the screen like every other drawn line
	it("holds a flagged starring line back without touching the title", async () => {
		const screen = screenAnswering(["BAD SUBHEAD"]);
		const flagged = strip("NO EXIT", "BAD SUBHEAD");
		await screen.update(flagged);
		const drawable = screen.drawable(flagged).panels[0];
		expect(drawable?.title).toBe("NO EXIT");
		expect(drawable?.starring).toBeUndefined();
		expect(screen.issues(flagged).map((issue) => issue.path)).toEqual([
			"panels[0].starring",
		]);
	});
});
