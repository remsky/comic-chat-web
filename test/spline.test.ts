import { describe, expect, it } from "vitest";
import { createBalloonSpline } from "../src/engine/balloonSpline.js";
import {
	addArrow,
	boxBalloonTraj,
	breakSpline,
	computeCloudBBox,
	normalBalloonTraj,
} from "../src/engine/balloonTail.js";
import type { FormatInfo } from "../src/engine/balloonText.js";
import {
	BetaSpline,
	betaMatrix,
	CardinalSpline,
	flatBezier,
	intBezierNearestPoint,
	splitBezier,
	walkHorizontalDist,
} from "../src/engine/spline.js";
import type { Point } from "../src/engine/vector2d.js";

const fontI = { lineHeight: 327, baseAdd: 60, leading: -70 };

function fInfoOf(
	lines: [number, number, number][],
	maxWidth: number,
): FormatInfo {
	return {
		nLines: lines.length,
		lines: lines.map(([length, width]) => ({ start: 0, length, width })),
		maxWidth,
		fbox: { left: 0, bottom: -427, right: maxWidth, top: 0 },
		leftX: lines.map((l) => l[2]),
		shifted: true,
	};
}

describe("betaMatrix", () => {
	it("has rows summing to 0,0,0,1 for the default tension 5 bias 1", () => {
		const m = betaMatrix(5.0, 1.0);
		const sums = m.map((row) => row.reduce((a, b) => a + b, 0));
		expect(sums[0]).toBeCloseTo(0, 12);
		expect(sums[1]).toBeCloseTo(0, 12);
		expect(sums[2]).toBeCloseTo(0, 12);
		expect(sums[3]).toBeCloseTo(1, 12);
	});

	it("matches hand-derived entries d = 1/17", () => {
		const m = betaMatrix(5.0, 1.0);
		expect(m[0][3]).toBeCloseTo(2 / 17, 14);
		expect(m[3][1]).toBeCloseTo(13 / 17, 14);
		expect(m[2][1]).toBeCloseTo(0, 14);
	});
});

describe("BetaSpline", () => {
	it("collapses to a constant point when all control points coincide", () => {
		const pt = { x: 100, y: 200 };
		const s = new BetaSpline([pt, pt, pt, pt], 4, true);
		expect(s.knotCount()).toBe(7);
		expect(s.bezierCount()).toBe(13);
		expect(s.bezpts).toHaveLength(13);
		for (const b of s.bezpts ?? []) expect(b).toEqual({ x: 100, y: 200 });
	});

	it("closes the loop within rounding tolerance on a square", () => {
		const cps: Point[] = [
			{ x: 0, y: 0 },
			{ x: 1000, y: 0 },
			{ x: 1000, y: 1000 },
			{ x: 0, y: 1000 },
		];
		const s = new BetaSpline(cps, 4, true);
		const bez = s.bezpts ?? [];
		const first = bez[0];
		const last = bez[bez.length - 1];
		expect(Math.abs((first?.x ?? 0) - (last?.x ?? 0))).toBeLessThanOrEqual(2);
		expect(Math.abs((first?.y ?? 0) - (last?.y ?? 0))).toBeLessThanOrEqual(2);
	});

	it("duplicates end knots on open splines per GetDups 3", () => {
		const cps: Point[] = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 20, y: 0 },
			{ x: 30, y: 0 },
		];
		const s = new BetaSpline(cps, 4, false);
		expect(s.knotCount()).toBe(8);
		expect(s.getKnot(0)).toEqual({ x: 0, y: 0 });
		expect(s.getKnot(2)).toEqual({ x: 0, y: 0 });
		expect(s.getKnot(3)).toEqual({ x: 10, y: 0 });
		expect(s.getKnot(4)).toEqual({ x: 20, y: 0 });
		expect(s.getKnot(5)).toEqual({ x: 30, y: 0 });
		expect(s.getKnot(7)).toEqual({ x: 30, y: 0 });
	});
});

describe("CardinalSpline", () => {
	it("uses dups 2 and open knotCount nCps + 2", () => {
		const cps: Point[] = [
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
			{ x: 20, y: 0 },
		];
		const s = new CardinalSpline(cps, 3, false);
		expect(s.knotCount()).toBe(5);
		expect(s.bezierCount()).toBe(7);
		expect(s.bezpts).toHaveLength(7);
	});
});

describe("bezier helpers", () => {
	const curved = {
		p0: { x: 0, y: 0 },
		p1: { x: 0, y: 100 },
		p2: { x: 100, y: 100 },
		p3: { x: 100, y: 0 },
	};

	it("splitBezier halves exactly by de Casteljau", () => {
		const { left, right } = splitBezier(curved);
		expect(left).toEqual({
			p0: { x: 0, y: 0 },
			p1: { x: 0, y: 50 },
			p2: { x: 25, y: 75 },
			p3: { x: 50, y: 75 },
		});
		expect(right).toEqual({
			p0: { x: 50, y: 75 },
			p1: { x: 75, y: 75 },
			p2: { x: 100, y: 50 },
			p3: { x: 100, y: 0 },
		});
	});

	it("flatBezier accepts collinear, rejects curved", () => {
		expect(
			flatBezier({
				p0: { x: 0, y: 0 },
				p1: { x: 100, y: 0 },
				p2: { x: 200, y: 0 },
				p3: { x: 300, y: 0 },
			}),
		).toBe(true);
		expect(flatBezier(curved)).toBe(false);
	});

	const flatPts: Point[] = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 200, y: 0 },
		{ x: 300, y: 0 },
	];

	it("walkHorizontalDist finds the goal crossing on a flat segment", () => {
		const { found, furthest } = walkHorizontalDist(flatPts, 0, 150);
		expect(found).toBe(true);
		expect(furthest.y).toBe(0);
		expect(Math.abs(furthest.x - 150)).toBeLessThanOrEqual(1);
	});

	it("walkHorizontalDist reports the rightmost point when the goal is beyond", () => {
		const { found, furthest } = walkHorizontalDist(flatPts, 0, 400);
		expect(found).toBe(false);
		expect(furthest).toEqual({ x: 300, y: 0 });
	});

	it("intBezierNearestPoint truncates the manhattan distance like the C casts", () => {
		const { dist, pos } = intBezierNearestPoint(flatPts, 0, { x: 150, y: 40 });
		expect(dist).toBe(40);
		expect(pos.y).toBe(0);
		expect(Math.abs(pos.x - 150)).toBeLessThanOrEqual(1);
	});
});

describe("breakSpline and addArrow", () => {
	const fInfo = fInfoOf([[5, 300, 0]], 300);

	function balloonBeta() {
		const pts = createBalloonSpline(fInfo, fontI);
		return new BetaSpline(pts.cps, pts.cps.length, true);
	}

	it("opens the spline and inserts the two gap points", () => {
		const s = balloonBeta();
		const before = s.nCps;
		breakSpline(s, 150, -427, 1.0);
		expect(s.closed).toBe(false);
		expect(s.nCps).toBeGreaterThan(2);
		expect(s.nCps).toBeLessThanOrEqual(before + 2);
		expect(s.bezpts).toHaveLength(s.bezierCount());
		const first = s.cpAt(0);
		const last = s.cpAt(s.nCps - 1);
		expect(first.x).toBeGreaterThan(last.x);
	});

	it("addArrow returns two arcs joining the gap to the speaker", () => {
		const s = balloonBeta();
		const ctx = {
			speakerArrowX: 1150,
			speakerTop: -1600,
			balloonLeft: 1000,
			balloonTop: -300,
			routeLeft: 900,
			routeRight: 1500,
			cloudBottom: -300 + computeCloudBBox(s.cps).bottom,
		};
		const arcs = addArrow(s, fInfo, ctx);
		expect(s.closed).toBe(false);
		expect(arcs[0].lo).toEqual(s.cpAt(s.nCps - 1));
		expect(arcs[1].hi).toEqual(s.cpAt(0));
		expect(arcs[0].hi).toEqual(arcs[1].lo);
		expect(arcs[1].altitude).toBe(-arcs[0].altitude);
	});

	it("normalBalloonTraj bundles the broken spline with its arcs", () => {
		const ctx = {
			speakerArrowX: 1150,
			speakerTop: -1600,
			balloonLeft: 1000,
			balloonTop: -300,
			routeLeft: 900,
			routeRight: 1500,
			cloudBottom: -750,
		};
		const traj = normalBalloonTraj(fInfo, fontI, ctx);
		expect(traj.closed).toBe(true);
		expect(traj.spline.closed).toBe(false);
		expect(traj.arcs).toHaveLength(2);
	});
});

describe("box balloon geometry", () => {
	const fbox = { left: 0, bottom: -500, right: 300, top: 0 };

	it("boxBalloonTraj draws the rectangle with the 90/50 deltas", () => {
		const [s1, s2, s3, s4] = boxBalloonTraj(fbox);
		expect(s1.lo).toEqual({ x: -90, y: -550 });
		expect(s1.hi).toEqual({ x: -90, y: 50 });
		expect(s2.hi).toEqual({ x: 390, y: 50 });
		expect(s3.hi).toEqual({ x: 390, y: -550 });
		expect(s4.hi).toEqual(s1.lo);
	});

	it("computeCloudBBox bounds the outline control points", () => {
		const pts = createBalloonSpline(fInfoOf([[5, 100, 0]], 100), fontI);
		expect(computeCloudBBox(pts.cps)).toEqual({
			left: -100,
			bottom: -407,
			right: 200,
			top: 40,
		});
	});
});
