import { describe, expect, it } from "vitest";
import { scrollDelta } from "../src/browser/dom.js";
import { moveItem, nearestIndex } from "../src/studio/reorder.js";

describe("moveItem", () => {
	it("moves an item forward", () => {
		const items = ["a", "b", "c", "d"];
		moveItem(items, 0, 2);
		expect(items).toEqual(["b", "c", "a", "d"]);
	});

	it("moves an item backward", () => {
		const items = ["a", "b", "c", "d"];
		moveItem(items, 3, 1);
		expect(items).toEqual(["a", "d", "b", "c"]);
	});

	it("leaves the list alone for a no-op or an out-of-range source", () => {
		const items = ["a", "b"];
		moveItem(items, 1, 1);
		moveItem(items, 5, 0);
		moveItem(items, -1, 0);
		expect(items).toEqual(["a", "b"]);
	});

	it("clamps a target past either end", () => {
		const items = ["a", "b", "c"];
		moveItem(items, 0, 9);
		expect(items).toEqual(["b", "c", "a"]);
		moveItem(items, 2, -4);
		expect(items).toEqual(["a", "b", "c"]);
	});
});

describe("nearestIndex", () => {
	const grid = [
		{ x: 50, y: 50 },
		{ x: 150, y: 50 },
		{ x: 50, y: 150 },
		{ x: 150, y: 150 },
	];

	it("picks the tile the pointer sits closest to", () => {
		expect(nearestIndex(grid, 40, 60)).toBe(0);
		expect(nearestIndex(grid, 160, 140)).toBe(3);
	});

	it("crosses rows, not just columns", () => {
		expect(nearestIndex(grid, 55, 149)).toBe(2);
	});

	it("reports nothing for an empty list", () => {
		expect(nearestIndex([], 0, 0)).toBe(-1);
	});
});

describe("scrollDelta", () => {
	it("stays put when the item already fits in view", () => {
		expect(scrollDelta(0, 100, 10, 40)).toBe(0);
	});

	it("scrolls back to an item above the view", () => {
		expect(scrollDelta(100, 200, 60, 90)).toBe(-40);
	});

	it("scrolls forward to an item below the view", () => {
		expect(scrollDelta(0, 100, 120, 150)).toBe(50);
	});

	// an item taller than the scroller aligns to the top rather than scrolling past it
	it("aligns an oversized item to the top edge", () => {
		expect(scrollDelta(0, 100, 20, 400)).toBe(20);
	});
});
