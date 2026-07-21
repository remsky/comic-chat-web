import { describe, expect, it } from "vitest";
import { isJoinedEntry, JOINED_STATE } from "../src/browser/roomHistory.js";

describe("isJoinedEntry", () => {
	it("treats a fresh load as not yet joined so the join pushes an entry", () => {
		expect(isJoinedEntry(null)).toBe(false);
		expect(isJoinedEntry(undefined)).toBe(false);
	});

	it("recognizes the entry the join pushed", () => {
		expect(isJoinedEntry(JOINED_STATE)).toBe(true);
	});

	it("replaces rather than stacks when a refused join is retried", () => {
		// the form is handed back on refusal, so submit can run again on the pushed entry
		expect(isJoinedEntry({ joined: true })).toBe(true);
	});

	it("ignores unrelated history state left by anything else", () => {
		expect(isJoinedEntry({})).toBe(false);
		expect(isJoinedEntry({ joined: false })).toBe(false);
		expect(isJoinedEntry({ joined: "yes" })).toBe(false);
		expect(isJoinedEntry("joined")).toBe(false);
		expect(isJoinedEntry(7)).toBe(false);
	});
});
