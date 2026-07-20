import { describe, expect, it } from "vitest";
import { isProhibited } from "../worker/moderation.js";

describe("profanity screen", () => {
	it("passes ordinary chat, including Scunthorpe-style false positives", () => {
		expect(isProhibited("hey, nice comic!")).toBe(false);
		expect(isProhibited("meet me in the arcade room")).toBe(false);
		expect(isProhibited("that is a classic scunthorpe case")).toBe(false);
	});

	it("blocks profanity and its leetspeak variants", () => {
		expect(isProhibited("fuck off")).toBe(true);
		expect(isProhibited("sh1t")).toBe(true);
		expect(isProhibited("a55hole")).toBe(true);
	});
});
