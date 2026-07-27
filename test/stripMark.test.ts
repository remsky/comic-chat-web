import { describe, expect, it } from "vitest";
import {
	drawStripMark,
	stripMarkGrowth,
	stripMarkParts,
} from "../src/browser/stripMark.js";

const CREDIT =
	"Engine ported from Comic Chat 1996 · characters by Jim Woodring";
// the studio sheet: one 600px panel column inside a 31px gutter
const GAP = 31;
const ONE_COLUMN = 662;
const FIVE_COLUMN = 3186;

function fakeContext() {
	const calls: { text: string; x: number; y: number; align: string }[] = [];
	const context = {
		font: "",
		fillStyle: "",
		textAlign: "",
		textBaseline: "",
		save: () => {},
		restore: () => {},
		fillText: (text: string, x: number, y: number) =>
			calls.push({ text, x, y, align: context.textAlign }),
	};
	return { context: context as unknown as CanvasRenderingContext2D, calls };
}

function mark(width: number, height: number, host = "fork.example") {
	const { context, calls } = fakeContext();
	drawStripMark(context, width, height, GAP, host);
	return { context, calls, fontPx: Number.parseInt(context.font, 10) };
}

describe("exported strip credit mark", () => {
	it("keeps the provenance together and signs with the deployment", () => {
		expect(stripMarkParts("comics.remsky.art")).toEqual({
			left: CREDIT,
			right: "comics.remsky.art",
		});
	});

	it("keeps the credit when there is no host to name", () => {
		const parts = stripMarkParts("");
		expect(parts.right).toBe("");
		expect(parts.left).toContain("Jim Woodring");
	});

	it("sets each end flush with the panel column it sits under", () => {
		const { calls } = mark(ONE_COLUMN, ONE_COLUMN);
		expect(calls.map(({ text, x, align }) => ({ text, x, align }))).toEqual([
			{ text: CREDIT, x: GAP, align: "left" },
			{ text: "fork.example", x: ONE_COLUMN - GAP, align: "right" },
		]);
	});

	it("draws both ends on one whole-pixel baseline inside the band", () => {
		for (const width of [ONE_COLUMN, FIVE_COLUMN]) {
			const height = 3000;
			const { calls, fontPx } = mark(width, height);
			const [first, second] = calls;
			expect(first?.y).toBe(second?.y);
			expect(Number.isInteger(first?.y)).toBe(true);
			// clear of the last panel row, and clear of the bottom edge
			const band = GAP + stripMarkGrowth(width, GAP);
			expect(first?.y).toBeGreaterThan(height - band);
			expect(first?.y).toBeLessThan(height - fontPx / 2);
		}
	});

	it("leaves a one-column sheet its original height", () => {
		expect(stripMarkGrowth(ONE_COLUMN, GAP)).toBe(0);
	});

	// a five-column sheet is five times the width; the mark must not be five times the type
	it("scales the type well under the sheet it grows with", () => {
		const one = mark(ONE_COLUMN, 3000).fontPx;
		const five = mark(FIVE_COLUMN, 3000).fontPx;
		expect(five).toBeGreaterThan(one);
		expect(five).toBeLessThan(one * 3);
		expect(stripMarkGrowth(FIVE_COLUMN, GAP)).toBe(five * 2 - GAP);
	});
});
