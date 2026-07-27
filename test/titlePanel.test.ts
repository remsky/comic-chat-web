import { describe, expect, it } from "vitest";
import {
	NO_TITLE,
	orderStars,
	randomTitle,
	shoutFontCell,
	TITLE_CHOICES,
	TITLE_TABLE,
	titleFontCell,
} from "../src/engine/titlePanel.js";

describe("randomTitle", () => {
	it("spans what it offers without running off the end", () => {
		expect(randomTitle(() => 0)).toBe(TITLE_CHOICES[0]);
		expect(randomTitle(() => 0.999999)).toBe(TITLE_CHOICES.at(-1));
		expect(randomTitle(() => 1)).toBe(TITLE_CHOICES.at(-1));
	});

	it("keeps the original sixteen titles", () => {
		expect(TITLE_TABLE).toHaveLength(16);
		expect(TITLE_TABLE).toContain("EVERYONE'S A COMIC");
		expect(TITLE_TABLE).toContain("MICROSOFT CHAT");
		expect(NO_TITLE).toBe("UNTITLED");
	});

	it("never offers the nonsense one or the old product name", () => {
		expect(TITLE_CHOICES).toHaveLength(14);
		expect(TITLE_CHOICES).not.toContain("DOGGY DOGGY WAH WAH");
		expect(TITLE_CHOICES).not.toContain("MICROSOFT CHAT");
	});
});

describe("title fonts", () => {
	it("scales with the unit but never drops below the balloon font", () => {
		expect(titleFontCell(3000, 400)).toBe(480);
		expect(titleFontCell(5200, 400)).toBe(616);
		expect(shoutFontCell(3000, 400)).toBe(400);
		expect(shoutFontCell(5200, 400)).toBe(400);
	});
});

describe("orderStars", () => {
	it("puts self first, the departed last, and busier talkers higher", () => {
		const ordered = orderStars([
			{ avatarID: 1, label: "quiet", sends: 1 },
			{ avatarID: 2, label: "gone", sends: 9, departed: true },
			{ avatarID: 3, label: "me", self: true, sends: 0 },
			{ avatarID: 4, label: "busy", sends: 5 },
		]);
		expect(ordered.map((star) => star.label)).toEqual([
			"me",
			"busy",
			"quiet",
			"gone",
		]);
	});

	it("keeps the given order for ties", () => {
		const ordered = orderStars([
			{ avatarID: 1, label: "a", sends: 2 },
			{ avatarID: 2, label: "b", sends: 2 },
		]);
		expect(ordered.map((star) => star.label)).toEqual(["a", "b"]);
	});
});
