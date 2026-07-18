import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	breakIntoLines,
	type FormatInfo,
	labelBreakIntoLines,
	shiftLines,
	type TextMeasure,
	widestWord,
} from "../src/engine/balloonText.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

// synthetic metrics: every char is 100 units wide, lines are 400 tall
const charMeasure: TextMeasure = (text) => ({
	cx: text.length * 100,
	cy: 400,
});

describe("breakIntoLines", () => {
	it("wraps at word boundaries within maxWidth", () => {
		const lines = breakIntoLines(charMeasure, 1100, "HELLO THERE BOLO!");
		expect(lines).toEqual([
			{ start: 0, length: 11, width: 1100 },
			{ start: 12, length: 5, width: 500 },
		]);
	});

	it("keeps an over-wide word intact, the modern word-wrap fix", () => {
		const lines = breakIntoLines(charMeasure, 500, "EXTRAORDINARY OK");
		expect(lines).toEqual([
			{ start: 0, length: 13, width: 1300 },
			{ start: 14, length: 2, width: 200 },
		]);
	});

	it("returns a single line when everything fits", () => {
		expect(breakIntoLines(charMeasure, 5000, "HEY ANNA")).toEqual([
			{ start: 0, length: 8, width: 800 },
		]);
	});
});

describe("shiftLines", () => {
	it("consumes one rand draw per line and centers with zero shift", () => {
		const fInfo: FormatInfo = {
			nLines: 2,
			lines: [
				{ start: 0, length: 5, width: 500 },
				{ start: 6, length: 3, width: 300 },
			],
			maxWidth: 500,
			fbox: { left: 0, bottom: -714, right: 500, top: 0 },
			leftX: [],
			shifted: false,
		};
		let draws = 0;
		shiftLines(fInfo, 0, () => {
			draws++;
			return 0.73;
		});
		expect(draws).toBe(2);
		expect(fInfo.leftX).toEqual([0, 100]);
		expect(fInfo.shifted).toBe(true);
	});
});

describe("widestWord", () => {
	it("scans printable runs, since C isprint includes space, and measures the trailing NUL", () => {
		const seen: string[] = [];
		widestWord((text) => {
			seen.push(text);
			return { cx: text.length, cy: 1 };
		}, "AB\nCDE");
		expect(seen).toEqual(["AB\n", `CDE${String.fromCharCode(0)}`]);
	});
});

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((f) => f.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s balloonFormat records", (name) => {
	const records = parseTrace(
		readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
	);

	// metrics maps per font, keyed exactly as the oracle measured
	const fonts = new Map<string, Map<string, number>>();
	for (const te of recordsOfType(records, "textExtent")) {
		const fontKey = `${te.fontFace}#${te.fontHeight}#${te.cy}`;
		let map = fonts.get(fontKey);
		if (!map) {
			map = new Map();
			fonts.set(fontKey, map);
		}
		const prior = map.get(te.str);
		expect(prior === undefined || prior === te.cx).toBe(true);
		map.set(te.str, te.cx);
	}

	const measureFrom = (map: Map<string, number>, cy: number): TextMeasure => {
		return (text) => {
			const cx = map.get(text);
			if (cx === undefined)
				throw new Error(`no oracle metric for ${JSON.stringify(text)}`);
			return { cx, cy };
		};
	};

	it("reproduces every balloonFormat from oracle metrics", () => {
		const balloons = recordsOfType(records, "balloon");
		const formats = recordsOfType(records, "balloonFormat");
		expect(formats.length).toBeGreaterThan(0);

		for (const fmt of formats) {
			const balloon = balloons.find(
				(b) => b.panel === fmt.panel && b.i === fmt.i,
			);
			expect(balloon, `balloon for panel ${fmt.panel}`).toBeDefined();
			if (!balloon) continue;

			const [fLeft, fBottom, fRight, fTop] = fmt.fbox;
			let matched = false;
			for (const [fontKey, map] of fonts) {
				if (!map.has(balloon.text)) continue;
				const cy = Number(fontKey.split("#")[2]);
				// leading -70 and baseAdd 60 are the balloon font constants from fonts.cpp
				const fontI = { lineHeight: cy - 70, baseAdd: 60, leading: -70 };
				for (const dw of [
					2 * fLeft + fmt.maxWidth,
					2 * fLeft + fmt.maxWidth + 1,
				]) {
					let fInfo: FormatInfo;
					try {
						fInfo = labelBreakIntoLines({
							str: balloon.text,
							format: 0,
							bbox: { left: 0, bottom: 0, right: dw, top: 0 },
							fontI,
							measure: measureFrom(map, cy),
						});
					} catch {
						continue;
					}
					shiftLines(fInfo, 0, () => 0.5);
					const got = {
						nLines: fInfo.nLines,
						maxWidth: fInfo.maxWidth,
						fbox: [
							fInfo.fbox.left,
							fInfo.fbox.bottom,
							fInfo.fbox.right,
							fInfo.fbox.top,
						],
						lines: fInfo.lines.map((l, i) => [
							l.length,
							l.width,
							fInfo.leftX[i],
						]),
					};
					const want = {
						nLines: fmt.nLines,
						maxWidth: fmt.maxWidth,
						fbox: [fLeft, fBottom, fRight, fTop],
						lines: fmt.lines,
					};
					if (JSON.stringify(got) === JSON.stringify(want)) {
						matched = true;
						break;
					}
				}
				if (matched) break;
			}
			expect(
				matched,
				`panel ${fmt.panel} balloon ${fmt.i} "${balloon.text}"`,
			).toBe(true);
		}
	});
});
