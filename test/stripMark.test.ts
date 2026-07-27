import { describe, expect, it } from "vitest";
import {
	drawStripMark,
	stripMarkGrowth,
	stripMarkParts,
} from "../src/browser/stripMark.js";

const CREDIT =
	"Comic Chat 1996 port · original character design by Jim Woodring";
// the export sheet both callers build: 600px panels inside a 31px gutter
const PANEL = 600;
const GAP = 31;

const PER_CHAR_EM = 0.5;

function fakeContext() {
	const calls: { text: string; x: number; y: number; align: string }[] = [];
	const context = {
		font: "",
		fillStyle: "",
		textAlign: "",
		textBaseline: "",
		save: () => {},
		restore: () => {},
		measureText: (text: string) => ({
			width: text.length * PER_CHAR_EM * Number.parseInt(context.font, 10),
		}),
		fillText: (text: string, x: number, y: number) =>
			calls.push({ text, x, y, align: context.textAlign }),
	};
	return { context: context as unknown as CanvasRenderingContext2D, calls };
}

function mark(width: number, height: number, host?: string) {
	const { context, calls } = fakeContext();
	drawStripMark(context, width, height, GAP, host);
	const fontPx = Number.parseInt(context.font, 10);
	const y = calls[0]?.y ?? Number.NaN;
	return {
		context,
		calls,
		fontPx,
		top: y - fontPx / 2,
		bottom: y + fontPx / 2,
	};
}

// mirrors the sheet roomView.ts and preview.ts each build in exportPng
function exportSheet(columns: number, rows: number) {
	const width = GAP + columns * (PANEL + GAP);
	return {
		width,
		height: GAP + rows * (PANEL + GAP) + stripMarkGrowth(width, GAP),
		lastPanelBottom: GAP + (rows - 1) * (PANEL + GAP) + PANEL,
	};
}

describe("exported strip credit mark", () => {
	it("keeps the provenance together and signs with the deployment", () => {
		expect(stripMarkParts("comics.remsky.art")).toEqual({
			left: CREDIT,
			right: "created at comics.remsky.art",
		});
	});

	it("keeps the credit when there is no host to name", () => {
		const parts = stripMarkParts("");
		expect(parts.right).toBe("");
		expect(parts.left).toContain("Jim Woodring");
	});

	// both call sites let the host default, so the branch production takes is this one
	it("names the page's own host when the caller passes none", () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, "location");
		Object.defineProperty(globalThis, "location", {
			value: { host: "fork.example" },
			configurable: true,
		});
		try {
			expect(mark(662, 662).calls[1]?.text).toBe("created at fork.example");
		} finally {
			if (original) Object.defineProperty(globalThis, "location", original);
			else Reflect.deleteProperty(globalThis, "location");
		}
	});

	it("sets each end flush with the panel column it sits under", () => {
		const { calls } = mark(662, 662, "fork.example");
		expect(calls.map(({ text, x, align }) => ({ text, x, align }))).toEqual([
			{ text: CREDIT, x: GAP, align: "left" },
			{ text: "created at fork.example", x: 662 - GAP, align: "right" },
		]);
	});

	it("draws both ends on one whole-pixel baseline", () => {
		const { calls } = mark(3186, 3000, "fork.example");
		expect(calls[0]?.y).toBe(calls[1]?.y);
		expect(Number.isInteger(calls[0]?.y)).toBe(true);
	});

	// the regression this guards: a caller that stops reserving the growth draws the mark over its own art
	it("clears the last panel row on every sheet a caller can build", () => {
		for (const [columns, rows] of [
			[1, 1],
			[2, 1],
			[4, 3],
			[5, 2],
			[5, 8],
		] as const) {
			const sheet = exportSheet(columns, rows);
			const { top, bottom } = mark(sheet.width, sheet.height, "fork.example");
			expect(top).toBeGreaterThanOrEqual(sheet.lastPanelBottom);
			expect(bottom).toBeLessThanOrEqual(sheet.height);
		}
	});

	it("never asks a sheet to shrink", () => {
		for (const width of [200, 662, 1293, 3186, 6000])
			expect(stripMarkGrowth(width, GAP)).toBeGreaterThanOrEqual(0);
	});

	it("leaves a one-column sheet its original height", () => {
		expect(stripMarkGrowth(exportSheet(1, 1).width, GAP)).toBe(0);
	});

	// a five-column sheet is five times the width; the mark must not be five times the type
	it("scales the type well under the sheet it grows with", () => {
		const one = mark(exportSheet(1, 1).width, 3000, "fork.example").fontPx;
		const five = mark(exportSheet(5, 1).width, 3000, "fork.example").fontPx;
		expect(one).toBeLessThanOrEqual(12);
		expect(five).toBeGreaterThan(one);
		expect(five).toBeLessThan(one * 3);
	});

	// a single-row sheet led by the borderless title card starts the credit under the first bordered panel
	it("starts where the caller says and still clears the host", () => {
		const start = GAP + PANEL + GAP;
		const width = exportSheet(2, 1).width;
		const { context, calls } = fakeContext();
		drawStripMark(context, width, 3000, GAP, "fork.example", start);
		const fontPx = Number.parseInt(context.font, 10);
		const measure = (text: string) => text.length * PER_CHAR_EM * fontPx;
		expect(calls[0]?.x).toBe(start);
		expect(calls[1]?.x).toBe(width - GAP);
		expect(start + measure(calls[0]?.text ?? "")).toBeLessThanOrEqual(
			width - GAP - measure(calls[1]?.text ?? ""),
		);
	});

	it("keeps the credit and the host from running into each other", () => {
		for (const columns of [1, 2, 5]) {
			const width = exportSheet(columns, 1).width;
			const { calls, fontPx } = mark(width, 3000, "comics.remsky.art");
			const [credit, signature] = calls;
			const measure = (text: string) => text.length * PER_CHAR_EM * fontPx;
			expect(fontPx).toBeGreaterThanOrEqual(9);
			expect(GAP + measure(credit?.text ?? "")).toBeLessThanOrEqual(
				width - GAP - measure(signature?.text ?? ""),
			);
		}
	});
});
