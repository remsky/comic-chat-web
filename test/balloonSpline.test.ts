import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBalloonSpline } from "../src/engine/balloonSpline.js";
import type { FontMetrics, FormatInfo } from "../src/engine/balloonText.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const fontI: FontMetrics = { lineHeight: 327, baseAdd: 60, leading: -70 };

function fInfoOf(
	lines: [number, number, number][],
	maxWidth: number,
): FormatInfo {
	return {
		nLines: lines.length,
		lines: lines.map(([length, width]) => ({ start: 0, length, width })),
		maxWidth,
		fbox: { left: 0, bottom: 0, right: 0, top: 0 },
		leftX: lines.map((l) => l[2]),
		shifted: true,
	};
}

describe("createBalloonSpline", () => {
	it("builds a plain 4 corner box for a narrow single line", () => {
		const spline = createBalloonSpline(fInfoOf([[5, 100, 0]], 100), fontI);
		expect(spline.closed).toBe(true);
		expect(spline.cps).toEqual([
			{ x: -100, y: 20 },
			{ x: -100, y: -407 },
			{ x: 200, y: -407 },
			{ x: 200, y: 40 },
		]);
	});

	it("adds wavies on long edges, with ROUND turning the -70 offset into -69", () => {
		const spline = createBalloonSpline(fInfoOf([[5, 1200, 0]], 1200), fontI);
		expect(spline.cps).toEqual([
			{ x: -100, y: 20 },
			{ x: -100, y: -407 },
			{ x: 250, y: -476 },
			{ x: 600, y: -407 },
			{ x: 950, y: -476 },
			{ x: 1300, y: -407 },
			{ x: 1300, y: 40 },
			{ x: 951, y: 106 },
			{ x: 602, y: 32 },
			{ x: 253, y: 98 },
		]);
	});

	it("keeps the asymmetric top corners: left gets TOPBORDER, right does not", () => {
		const spline = createBalloonSpline(fInfoOf([[5, 100, 0]], 100), fontI);
		expect(spline.cps[0]?.y).toBe(20);
		expect(spline.cps[3]?.y).toBe(40);
	});
});

describe("smoke-01 balloonSpline records", () => {
	const records = parseTrace(
		readFileSync(new URL("../traces/smoke-01.jsonl", import.meta.url), "utf8"),
	);
	const lineHeights = [
		...new Set(recordsOfType(records, "textExtent").map((te) => te.cy - 70)),
	];

	it("reproduces every spline control point list exactly", () => {
		const formats = recordsOfType(records, "balloonFormat");
		const splines = recordsOfType(records, "balloonSpline");
		expect(splines).toHaveLength(11);

		for (const sp of splines) {
			const fmt = formats.find((f) => f.panel === sp.panel && f.i === sp.i);
			expect(fmt, `format for panel ${sp.panel}`).toBeDefined();
			if (!fmt) continue;

			const fInfo = fInfoOf(fmt.lines, fmt.maxWidth);
			const want = sp.cps.map(([x, y]) => ({ x, y }));
			const matched = lineHeights.some((lineHeight) => {
				const got = createBalloonSpline(fInfo, {
					lineHeight,
					baseAdd: 60,
					leading: -70,
				});
				return (
					got.cps.length === sp.nCps &&
					JSON.stringify(got.cps) === JSON.stringify(want)
				);
			});
			expect(matched, `panel ${sp.panel} balloon ${sp.i}`).toBe(true);
		}
	});
});
