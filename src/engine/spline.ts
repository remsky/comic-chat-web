// Port of spline.cpp and splinutl.cpp: beta/cardinal splines, bezier conversion, curve walkers.

import {
	type DPoint,
	dpointAdd,
	dpointDist,
	dpointScalmult,
	dpointSub,
	dpointToPoint,
	LARGENUMBER,
	type Point,
	round,
	SMALLNUMBER,
} from "./vector2d.js";

export type Matrix = [
	[number, number, number, number],
	[number, number, number, number],
	[number, number, number, number],
	[number, number, number, number],
];

export function cardinalMatrix(tension: number): Matrix {
	return [
		[-tension, 2.0 - tension, tension - 2.0, tension],
		[2.0 * tension, tension - 3.0, 3.0 - 2.0 * tension, -tension],
		[-tension, 0.0, tension, 0.0],
		[0.0, 1.0, 0.0, 0.0],
	];
}

export function betaMatrix(tension: number, bias: number): Matrix {
	const b2 = bias * bias;
	const b3 = bias * b2;
	const d = 1.0 / (tension + 2.0 * b3 + 4.0 * (b2 + bias) + 2.0);
	const m: Matrix = [
		[
			-2.0 * b3,
			2.0 * (tension + b3 + b2 + bias),
			-2.0 * (tension + b2 + bias + 1.0),
			2.0,
		],
		[
			6.0 * b3,
			-3.0 * (tension + 2.0 * (b3 + b2)),
			3.0 * (tension + 2.0 * b2),
			0.0,
		],
		[-6.0 * b3, 6.0 * (b3 - bias), 6.0 * bias, 0.0],
		[2.0 * b3, tension + 4.0 * (b2 + bias), 2.0, 0.0],
	];
	for (const row of m) for (let j = 0; j < 4; j++) row[j] = (row[j] ?? 0) * d;
	return m;
}

export function cvertsToCubic(
	m: Matrix,
	k0: Point,
	k1: Point,
	k2: Point,
	k3: Point,
): [Point, Point, Point, Point] {
	const c3: Point = {
		x: round(m[0][0] * k0.x + m[0][1] * k1.x + m[0][2] * k2.x + m[0][3] * k3.x),
		y: round(m[0][0] * k0.y + m[0][1] * k1.y + m[0][2] * k2.y + m[0][3] * k3.y),
	};
	const c2: Point = {
		x: round(m[1][0] * k0.x + m[1][1] * k1.x + m[1][2] * k2.x + m[1][3] * k3.x),
		y: round(m[1][0] * k0.y + m[1][1] * k1.y + m[1][2] * k2.y + m[1][3] * k3.y),
	};
	const c1: Point = {
		x: round(m[2][0] * k0.x + m[2][1] * k1.x + m[2][2] * k2.x + m[2][3] * k3.x),
		y: round(m[2][0] * k0.y + m[2][1] * k1.y + m[2][2] * k2.y + m[2][3] * k3.y),
	};
	const c0: Point = {
		x: round(m[3][0] * k0.x + m[3][1] * k1.x + m[3][2] * k2.x + m[3][3] * k3.x),
		y: round(m[3][0] * k0.y + m[3][1] * k1.y + m[3][2] * k2.y + m[3][3] * k3.y),
	};
	return [c0, c1, c2, c3];
}

export function cubicToBezier(
	c0: Point,
	c1: Point,
	c2: Point,
	c3: Point,
): [Point, Point, Point, Point] {
	const b0: Point = { x: c0.x, y: c0.y };
	const b1: Point = {
		x: c0.x + round((1.0 / 3.0) * c1.x),
		y: c0.y + round((1.0 / 3.0) * c1.y),
	};
	const b2: Point = {
		x: b1.x + round((1.0 / 3.0) * (c1.x + c2.x)),
		y: b1.y + round((1.0 / 3.0) * (c1.y + c2.y)),
	};
	const b3: Point = {
		x: c0.x + c1.x + c2.x + c3.x,
		y: c0.y + c1.y + c2.y + c3.y,
	};
	return [b0, b1, b2, b3];
}

export interface Bezier {
	p0: DPoint;
	p1: DPoint;
	p2: DPoint;
	p3: DPoint;
}

export const EPSILON = 1.0;

export function splitBezier(b: Bezier): { left: Bezier; right: Bezier } {
	const lp1 = dpointScalmult(0.5, dpointAdd(b.p0, b.p1));
	const t = dpointScalmult(0.5, dpointAdd(b.p1, b.p2));
	const lp2 = dpointScalmult(0.5, dpointAdd(lp1, t));
	const rp2 = dpointScalmult(0.5, dpointAdd(b.p2, b.p3));
	const rp1 = dpointScalmult(0.5, dpointAdd(t, rp2));
	const shared = dpointScalmult(0.5, dpointAdd(lp2, rp1));
	return {
		left: { p0: b.p0, p1: lp1, p2: lp2, p3: shared },
		right: { p0: shared, p1: rp1, p2: rp2, p3: b.p3 },
	};
}

function insideTol(
	pt: DPoint,
	xmin: number,
	xmax: number,
	ymin: number,
	ymax: number,
	tol: number,
): boolean {
	return !(
		pt.x + tol < xmin ||
		pt.x - tol > xmax ||
		pt.y + tol < ymin ||
		pt.y - tol > ymax
	);
}

export function flatBezier(b: Bezier): boolean {
	const xmin = Math.min(b.p0.x, b.p3.x);
	const xmax = Math.max(b.p0.x, b.p3.x);
	const ymin = Math.min(b.p0.y, b.p3.y);
	const ymax = Math.max(b.p0.y, b.p3.y);
	if (
		!insideTol(b.p1, xmin, xmax, ymin, ymax, 0.5 * EPSILON) ||
		!insideTol(b.p2, xmin, xmax, ymin, ymax, 0.5 * EPSILON)
	)
		return false;
	const d1 = dpointSub(b.p1, b.p0);
	const d2 = dpointSub(b.p2, b.p0);
	const d = dpointSub(b.p3, b.p0);
	const dx = Math.abs(d.x);
	const dy = Math.abs(d.y);
	if (dx + dy < EPSILON) return true;
	if (dy < dx) {
		const dydx = d.y / d.x;
		return (
			Math.abs(d2.y - d2.x * dydx) < EPSILON &&
			Math.abs(d1.y - d1.x * dydx) < EPSILON
		);
	}
	const dxdy = d.x / d.y;
	return (
		Math.abs(d2.x - d2.y * dxdy) < EPSILON &&
		Math.abs(d1.x - d1.y * dxdy) < EPSILON
	);
}

export function subdivide(
	bezier: Bezier,
	proc: (pt: DPoint) => boolean,
	delta: number,
): boolean {
	if (flatBezier(bezier)) {
		const length = dpointDist(bezier.p0, bezier.p3);
		if (length > SMALLNUMBER) {
			const step = delta / length;
			for (let alpha = 0.0; alpha <= 1.0; alpha += step) {
				const pt = dpointAdd(
					dpointScalmult(alpha, bezier.p3),
					dpointScalmult(1.0 - alpha, bezier.p0),
				);
				if (proc(pt)) return true;
			}
		}
		return proc({ x: bezier.p3.x, y: bezier.p3.y });
	}
	const { left, right } = splitBezier(bezier);
	return subdivide(left, proc, delta) || subdivide(right, proc, delta);
}

export function walkPath(
	beziers: Bezier[],
	proc: (pt: DPoint) => boolean,
): boolean {
	for (const b of beziers) if (subdivide(b, proc, EPSILON)) return true;
	return false;
}

export function flatten(
	bezier: Bezier,
	proc: (pt: DPoint) => boolean,
): boolean {
	if (flatBezier(bezier)) return proc({ x: bezier.p3.x, y: bezier.p3.y });
	const { left, right } = splitBezier(bezier);
	return flatten(left, proc) || flatten(right, proc);
}

// cb_nearest uses manhattan distance on purpose (a speed hack noted in the C)
export function splineNearestPoint(
	beziers: Bezier[],
	givenPt: DPoint,
): { dist: number; foundPt: DPoint } {
	let dist = LARGENUMBER;
	let foundPt: DPoint = { x: 0, y: 0 };
	walkPath(beziers, (pt) => {
		const thisDist = Math.abs(pt.x - givenPt.x) + Math.abs(pt.y - givenPt.y);
		if (thisDist < dist) {
			dist = thisDist;
			foundPt = { x: pt.x, y: pt.y };
		}
		return false;
	});
	return { dist, foundPt };
}

export function bezierAt(bezpts: Point[], offset: number): Bezier {
	const p = (i: number): DPoint => {
		const pt = bezpts[offset + i] ?? { x: 0, y: 0 };
		return { x: pt.x, y: pt.y };
	};
	return { p0: p(0), p1: p(1), p2: p(2), p3: p(3) };
}

// the C casts truncate here; its own comment says "should round" but it does not
export function intBezierNearestPoint(
	bezpts: Point[],
	offset: number,
	given: Point,
): { dist: number; pos: Point } {
	const { dist, foundPt } = splineNearestPoint([bezierAt(bezpts, offset)], {
		x: given.x,
		y: given.y,
	});
	return {
		dist: Math.trunc(dist) | 0,
		pos: { x: Math.trunc(foundPt.x) | 0, y: Math.trunc(foundPt.y) | 0 },
	};
}

export function walkHorizontalDist(
	bezpts: Point[],
	offset: number,
	goalX: number,
): { found: boolean; furthest: Point } {
	let foundPt: DPoint = { x: -1000000, y: 0 };
	const found = walkPath([bezierAt(bezpts, offset)], (pt) => {
		if (pt.x > foundPt.x) foundPt = { x: pt.x, y: pt.y };
		return pt.x >= goalX;
	});
	return { found, furthest: dpointToPoint(foundPt) };
}

export abstract class Spline {
	closed: boolean;
	matrix: Matrix;
	bezpts: Point[] | null = null;
	nCps: number;
	cps: Point[];

	protected constructor(
		cpArray: Point[],
		n: number,
		isClosed: boolean,
		matrix: Matrix,
	) {
		this.nCps = n;
		this.cps = cpArray.slice(0, n).map((p) => ({ x: p.x, y: p.y }));
		this.closed = isClosed;
		this.matrix = matrix;
	}

	abstract getDups(): number;
	abstract knotCount(): number;

	bezierCount(): number {
		return 3 * this.knotCount() - 8;
	}

	cpAt(index: number): Point {
		return this.cps[index] ?? { x: 0, y: 0 };
	}

	getKnot(index: number): Point {
		if (this.closed) {
			if (index === 0) return this.cpAt(this.nCps - 1);
			if (index === this.nCps + 1) return this.cpAt(0);
			if (index === this.nCps + 2) return this.cpAt(1);
			return this.cpAt(index - 1);
		}
		const dups = this.getDups();
		if (index < dups) return this.cpAt(0);
		if (index >= this.nCps + dups - 2) return this.cpAt(this.nCps - 1);
		return this.cpAt(index - dups + 1);
	}

	computeBezpts(): void {
		const nKnots = this.knotCount();
		if (!this.bezpts) this.bezpts = new Array<Point>(this.bezierCount());
		const bez = this.bezpts;
		let bezIndex = 1;
		let knot0 = this.getKnot(0);
		let knot1 = this.getKnot(1);
		let knot2 = this.getKnot(2);
		let knot3 = this.getKnot(3);
		for (let i = 0; ; i++) {
			const [c0, c1, c2, c3] = cvertsToCubic(
				this.matrix,
				knot0,
				knot1,
				knot2,
				knot3,
			);
			const [b0, b1, b2, b3] = cubicToBezier(c0, c1, c2, c3);
			if (i === 0) bez[0] = b0;
			bez[bezIndex] = b1;
			bez[bezIndex + 1] = b2;
			bez[bezIndex + 2] = b3;
			if (i + 4 === nKnots) return;
			bezIndex += 3;
			knot0 = knot1;
			knot1 = knot2;
			knot2 = knot3;
			knot3 = this.getKnot(i + 4);
		}
	}

	closestPoint(toPt: Point): { pos: Point; knotIndex: number } {
		let minDist = 10000000;
		const bezCount = this.bezierCount();
		const bez = this.bezpts ?? [];
		let minPos: Point = { x: 0, y: 0 };
		let knotIndex = 0;
		for (let i = 0; i < bezCount - 1; i += 3) {
			const { dist, pos } = intBezierNearestPoint(bez, i, toPt);
			if (dist < minDist) {
				minDist = dist;
				minPos = pos;
				knotIndex = i / 3 + 2;
			}
		}
		return { pos: minPos, knotIndex };
	}

	walkHorizontalDistance(
		_fromPt: Point,
		fromKnotIndex: number,
		goalX: number,
	): { pt: Point; foundKnotIndex: number } {
		const bezCount = this.bezierCount();
		const bez = this.bezpts ?? [];
		let foundKnotIndex = -1;
		let index = (fromKnotIndex - 2) * 3;
		let lastFurthest: Point = { x: -100000, y: -100000 };
		for (let i = 0; i < bezCount - 1; i += 3) {
			if (index + 3 > bezCount - 1) index = 0;
			const { found, furthest } = walkHorizontalDist(bez, index, goalX);
			if (found) return { pt: furthest, foundKnotIndex: index / 3 + 2 };
			if (furthest.x > lastFurthest.x) {
				foundKnotIndex = index / 3 + 2;
				lastFurthest = furthest;
			}
			index += 3;
		}
		return { pt: lastFurthest, foundKnotIndex };
	}
}

export class BetaSpline extends Spline {
	static defaultTension = 5.0;
	static defaultBias = 1.0;
	tension: number;
	bias: number;

	constructor(cpArray: Point[], n: number, isClosed: boolean) {
		super(
			cpArray,
			n,
			isClosed,
			betaMatrix(BetaSpline.defaultTension, BetaSpline.defaultBias),
		);
		this.tension = BetaSpline.defaultTension;
		this.bias = BetaSpline.defaultBias;
		this.computeBezpts();
	}

	getDups(): number {
		return 3;
	}

	knotCount(): number {
		return this.closed ? this.nCps + 3 : this.nCps + 4;
	}
}

export class CardinalSpline extends Spline {
	static defaultTension = 0.4;
	tension: number;

	constructor(cpArray: Point[], n: number, isClosed: boolean) {
		super(cpArray, n, isClosed, cardinalMatrix(CardinalSpline.defaultTension));
		this.tension = CardinalSpline.defaultTension;
		this.computeBezpts();
	}

	getDups(): number {
		return 2;
	}

	knotCount(): number {
		return this.closed ? this.nCps + 3 : this.nCps + 2;
	}
}
