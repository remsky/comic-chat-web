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

describe("strip screen verdicts in flight", () => {
	// the editor types into the actor the screen already answered for, so identity carries the flag
	function typedActor(): { strip: Strip; retype: (text: string) => void } {
		const typed = strip();
		const actor = typed.panels[0]?.actors[0];
		if (!actor) throw new Error("the fixture lost its actor");
		return { strip: typed, retype: (text) => (actor.text = text) };
	}

	it("holds the flag while the next verdict is still in flight", async () => {
		const screen = screenAnswering(["BAD LINE"]);
		const { strip: flagged, retype } = typedActor();
		retype("BAD LINE");
		await screen.update(flagged);
		expect(screen.drawable(flagged).panels[0]?.actors[0]?.text).toBeUndefined();
		expect(screen.issues(flagged)).toHaveLength(1);

		// the next keystroke has no verdict yet, so the flag cannot lapse on the redraw
		retype("BAD LINE and more");
		expect(screen.drawable(flagged).panels[0]?.actors[0]?.text).toBeUndefined();
		expect(screen.issues(flagged).map((issue) => issue.path)).toEqual([
			"panels[0].actors[0]",
		]);
	});

	it("clears the flag once the verdict for the new line lands", async () => {
		const screen = screenAnswering(["BAD LINE"]);
		const { strip: flagged, retype } = typedActor();
		retype("BAD LINE");
		await screen.update(flagged);
		expect(screen.drawable(flagged).panels[0]?.actors[0]?.text).toBeUndefined();
		expect(screen.issues(flagged)).toHaveLength(1);

		retype("clean line");
		await screen.update(flagged);
		expect(screen.drawable(flagged).panels[0]?.actors[0]?.text).toBe(
			"clean line",
		);
		expect(screen.issues(flagged)).toEqual([]);
	});
});
