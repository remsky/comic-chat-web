import { describe, expect, it } from "vitest";
import type { Catalog } from "../../worker/mcp/catalog.js";
import { checkStrip, MAX_TEXT, MAX_TITLE } from "../../worker/mcp/validate.js";

const CATALOG: Catalog = {
	version: 2,
	art: "test",
	emotions: ["neutral", "happy"],
	gestures: ["wave"],
	modes: ["say", "think", "whisper", "action"],
	cameras: ["wide", "close"],
	facings: ["left", "right"],
	sizes: ["modern"],
	kinds: ["scene", "title"],
	backgrounds: ["den"],
	limits: { actors: 5, balloons: 3, zoom: [0.5, 2], columns: [1, 8] },
	avatars: [{ name: "dan", emotions: { neutral: 1, happy: 3 }, gestures: [] }],
	registers: [],
};

const scene = (text: string) => ({
	version: 2,
	panels: [{ actors: [{ avatar: "dan", text }] }],
});

const card = (field: string, value: string) => ({
	version: 2,
	panels: [{ kind: "title", [field]: value, actors: [{ avatar: "dan" }] }],
});

const at = (raw: unknown, path: string) =>
	checkStrip(raw, CATALOG).filter((issue) => issue.path === path);

describe("the strip validator's length checks", () => {
	it("warns on a crowded balloon without failing it", () => {
		const issues = at(scene("x".repeat(120)), "panels[0].actors[0].text");
		expect(issues).toHaveLength(1);
		expect(issues[0]?.severity).toBe("warning");
	});

	// create_strip's schema rejects these outright, so validate_strip must not call them survivable
	it("errors on a balloon past the cap create_strip enforces", () => {
		const issues = at(
			scene("x".repeat(MAX_TEXT + 1)),
			"panels[0].actors[0].text",
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.severity).toBe("error");
		expect(issues[0]?.message).toContain(`${MAX_TEXT} character cap`);
	});

	it("passes a balloon sitting exactly on the cap", () => {
		const issues = at(scene("x".repeat(MAX_TEXT)), "panels[0].actors[0].text");
		expect(issues.map((issue) => issue.severity)).toEqual(["warning"]);
	});

	it.each(["title", "starring", "footer"])(
		"errors on a %s past the cap",
		(field) => {
			const issues = at(
				card(field, "x".repeat(MAX_TITLE + 1)),
				`panels[0].${field}`,
			);
			expect(issues.map((issue) => issue.severity)).toEqual(["error"]);
		},
	);

	it("errors on a credit row past the cap", () => {
		const raw = {
			version: 2,
			panels: [
				{
					kind: "title",
					actors: [{ avatar: "dan", text: "x".repeat(MAX_TEXT + 1) }],
				},
			],
		};
		const issues = at(raw, "panels[0].actors[0].text");
		expect(issues.map((issue) => issue.severity)).toEqual(["error"]);
	});
});
