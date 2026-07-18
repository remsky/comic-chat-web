import { describe, expect, it } from "vitest";
import {
	CanvasTextMeasurer,
	NORMAL_FONT_METRICS,
	WHISPER_FONT_METRICS,
} from "../src/browser/canvasText.js";
import { SM_SAY, SM_WHISPER } from "../src/engine/panel.js";

class FakeContext {
	font = "";
	calls: [font: string, text: string][] = [];

	measureText(text: string): { width: number } {
		this.calls.push([this.font, text]);
		return { width: text.length * 10.4 };
	}
}

describe("canvas text metrics adapter", () => {
	it("caches rounded widths by font and text", () => {
		const context = new FakeContext();
		const measurer = new CanvasTextMeasurer(context);
		const normal = measurer.measure("normal", 397);
		expect(normal("HELLO")).toEqual({ cx: 52, cy: 397 });
		expect(normal("HELLO")).toEqual({ cx: 52, cy: 397 });
		expect(measurer.measure("italic", 384)("HELLO")).toEqual({
			cx: 52,
			cy: 384,
		});
		expect(context.calls).toEqual([
			["normal", "HELLO"],
			["italic", "HELLO"],
		]);
	});

	it("treats GDI's explicit NUL as zero-width", () => {
		const context = new FakeContext();
		const measure = new CanvasTextMeasurer(context).measure("system", 212);
		expect(measure("WORD\0")).toEqual(measure("WORD"));
		expect(context.calls).toEqual([["system", "WORD"]]);
	});

	it("evicts the least recently used width from a bounded cache", () => {
		const context = new FakeContext();
		const measurer = new CanvasTextMeasurer(context, { maxEntries: 2 });
		const measure = measurer.measure("normal", 397);
		measure("A");
		measure("B");
		measure("A");
		measure("C");
		measure("B");
		expect(context.calls.map((call) => call[1])).toEqual(["A", "B", "C", "B"]);
		expect(measurer.size).toBe(2);
	});

	it("resolves normal and whisper styles with stable oracle line metrics", () => {
		const resolver = new CanvasTextMeasurer(new FakeContext()).styleResolver();
		expect(resolver("HELLO", SM_SAY).font).toEqual(NORMAL_FONT_METRICS);
		expect(resolver("PSST", SM_WHISPER).font).toEqual(WHISPER_FONT_METRICS);
		expect(resolver("HELLO", SM_SAY).widestMeasure).toBe(
			resolver("PSST", SM_WHISPER).widestMeasure,
		);
	});
});
