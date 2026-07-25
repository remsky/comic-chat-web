import { describe, expect, it } from "vitest";
import { isProhibited, screeningEnabled } from "../worker/moderation.js";

describe("profanity screen", () => {
	it("passes ordinary chat, including Scunthorpe-style false positives", () => {
		expect(isProhibited("hey, nice comic!")).toBe(false);
		expect(isProhibited("meet me in the arcade room")).toBe(false);
		expect(isProhibited("that is a classic scunthorpe case")).toBe(false);
	});

	it("blocks profanity and its leetspeak variants", () => {
		expect(isProhibited("4rse off")).toBe(true);
		expect(isProhibited("4rs3")).toBe(true);
		expect(isProhibited("ärse")).toBe(true);
	});

	it("stays on unless a deploy opts out by name", () => {
		expect(screeningEnabled({})).toBe(true);
		expect(screeningEnabled({ MODERATION: "on" })).toBe(true);
		expect(screeningEnabled({ MODERATION: "" })).toBe(true);
		expect(screeningEnabled({ MODERATION: "off" })).toBe(false);
	});
});
