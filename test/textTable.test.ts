import { describe, expect, it } from "vitest";
import {
	COMIC_NEUE_ITALIC,
	COMIC_NEUE_REGULAR,
} from "../src/render/comicNeueMetrics.js";
import { gdiCellFont } from "../src/render/textMetrics.js";
import { parseFontPx, TableMeasureContext } from "../src/render/textTable.js";

describe("TableMeasureContext", () => {
	const context = new TableMeasureContext();

	it("scales advance widths by the css pixel size", () => {
		context.font = "400 100px 'Comic Neue'";
		const single = context.measureText("M").width;
		context.font = "400 200px 'Comic Neue'";
		expect(context.measureText("M").width).toBeCloseTo(single * 2, 6);
		expect(context.measureText("MM").width).toBeCloseTo(single * 4, 6);
	});

	it("reads the italic face for italic font strings", () => {
		const scale = 400 / COMIC_NEUE_REGULAR.unitsPerEm;
		context.font = "400 400px 'Comic Neue'";
		expect(context.measureText("g").width).toBeCloseTo(
			(COMIC_NEUE_REGULAR.advances.g ?? 0) * scale,
			6,
		);
		context.font = "italic 400 400px 'Comic Neue'";
		expect(context.measureText("g").width).toBeCloseTo(
			(COMIC_NEUE_ITALIC.advances.g ?? 0) *
				(400 / COMIC_NEUE_ITALIC.unitsPerEm),
			6,
		);
	});

	it("falls back to a stand-in advance for glyphs outside the table", () => {
		context.font = "400 100px 'Comic Neue'";
		expect(context.measureText("世").width).toBeCloseTo(
			(COMIC_NEUE_REGULAR.fallbackAdvance / COMIC_NEUE_REGULAR.unitsPerEm) *
				100,
			6,
		);
	});

	it("anchors metrics to the current textBaseline like a real canvas", () => {
		context.font = "400 100px 'Comic Neue'";
		const scale = 100 / COMIC_NEUE_REGULAR.unitsPerEm;
		const flat = context.measureText("m");
		const deep = context.measureText("g");
		expect(flat.actualBoundingBoxDescent).toBeLessThan(1);
		expect(deep.actualBoundingBoxDescent).toBeCloseTo(
			(COMIC_NEUE_REGULAR.inkDescents.g ?? 0) * scale,
			6,
		);
		context.textBaseline = "top";
		const top = context.measureText("g");
		expect(top.fontBoundingBoxAscent).toBeCloseTo(0, 6);
		expect(
			top.actualBoundingBoxDescent - top.fontBoundingBoxAscent,
		).toBeCloseTo(
			(COMIC_NEUE_REGULAR.ascent + (COMIC_NEUE_REGULAR.inkDescents.g ?? 0)) *
				scale,
			6,
		);
		context.textBaseline = "alphabetic";
	});

	it("drives gdiCellFont to a smaller em when the font box outgrows the cell", () => {
		const font = gdiCellFont(context, "400", 400);
		const px = parseFontPx(font);
		const box = COMIC_NEUE_REGULAR.ascent + COMIC_NEUE_REGULAR.descent;
		expect(px).toBe(
			Math.round((400 * 400) / ((box / COMIC_NEUE_REGULAR.unitsPerEm) * 400)),
		);
		expect(px).toBeLessThan(400);
	});
});
