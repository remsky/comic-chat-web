// Port of the balloon outline half of balloon.cpp: filters, permutation, wavies, spline points.

import type { FontMetrics, FormatInfo } from "./balloonText.js";
import {
	type DPoint,
	dpointScalmult,
	dpointSub,
	dpointToPoint,
	LARGEINTEGER,
	type Point,
	pointDist,
	pointToDpoint,
} from "./vector2d.js";

export const THRESH1 = -70;
export const THRESH2 = 70;
export const XBORDER = 100;
export const YBORDER = 40;
export const TOPBORDER = -20;
export const VWAVEHEIGHT = 70;
export const VWAVEINTERVAL = 300;
export const HWAVEHEIGHT = 70;
export const HWAVEINTERVAL = 300;

export interface Filter {
	start: number;
	end: number;
	x: number;
	y: number;
}

export interface SplinePoints {
	closed: boolean;
	cps: Point[];
}

export function getFilters(fInfo: FormatInfo): {
	left: Filter[];
	right: Filter[];
} {
	const leftXAt = (i: number) => fInfo.leftX[i] ?? 0;
	const widthAt = (i: number) => fInfo.lines[i]?.width ?? 0;

	let curL: Filter = { start: 0, end: 0, x: leftXAt(0), y: 0 };
	let curR: Filter = { start: 0, end: 0, x: leftXAt(0) + widthAt(0), y: 0 };
	const left: Filter[] = [curL];
	const right: Filter[] = [curR];

	for (let i = 1; i < fInfo.nLines; i++) {
		const thisLeft = leftXAt(i);
		const thisRight = leftXAt(i) + widthAt(i);
		const leftDelta = thisLeft - curL.x;
		const rightDelta = thisRight - curR.x;

		if (leftDelta <= THRESH1) {
			curL.end = i - 1;
			curL = { start: i, end: 0, x: thisLeft, y: 0 };
			left.push(curL);
		} else if (leftDelta <= 0) {
			curL.x = thisLeft;
		} else if (leftDelta >= THRESH2) {
			const nextLeft = i + 1 < fInfo.nLines ? leftXAt(i + 1) : thisLeft;
			if (nextLeft - curL.x >= THRESH2) {
				curL.end = i - 1;
				curL = { start: i, end: 0, x: Math.min(thisLeft, nextLeft), y: 0 };
				left.push(curL);
			}
		}

		if (rightDelta >= -THRESH1) {
			curR.end = i - 1;
			curR = { start: i, end: 0, x: thisRight, y: 0 };
			right.push(curR);
		} else if (rightDelta >= 0) {
			curR.x = thisRight;
		} else if (rightDelta <= -THRESH2) {
			const nextRight =
				i + 1 < fInfo.nLines ? leftXAt(i + 1) + widthAt(i + 1) : thisRight;
			if (nextRight - curR.x <= -THRESH2) {
				curR.end = i - 1;
				curR = { start: i, end: 0, x: Math.max(thisRight, nextRight), y: 0 };
				right.push(curR);
			}
		}
	}

	curL.end = fInfo.nLines - 1;
	curR.end = fInfo.nLines - 1;
	return { left, right };
}

export function permuteFilters(
	fontI: FontMetrics,
	lFilters: Filter[],
	rFilters: Filter[],
): number {
	let baseY = 0;
	let lastX = LARGEINTEGER;
	for (let i = 0; i < lFilters.length; i++) {
		const f = lFilters[i];
		if (!f) break;
		f.x -= XBORDER;
		if (i === 0) f.y = baseY + TOPBORDER + YBORDER;
		else if (f.x < lastX) f.y = baseY + YBORDER;
		else f.y = baseY - YBORDER - fontI.baseAdd;
		baseY -= (f.end - f.start + 1) * fontI.lineHeight;
		lastX = f.x;
	}

	baseY = 0;
	lastX = -LARGEINTEGER;
	for (let i = 0; i < rFilters.length; i++) {
		const f = rFilters[i];
		if (!f) break;
		f.x += XBORDER;
		// faithful to balloon.cpp:397: the i==0 assignment is overwritten by the plain if that follows
		if (i === 0) f.y = baseY + TOPBORDER + YBORDER;
		if (f.x > lastX) f.y = baseY + YBORDER;
		else f.y = baseY - YBORDER - fontI.baseAdd;
		baseY -= (f.end - f.start + 1) * fontI.lineHeight;
		lastX = f.x;
	}
	return baseY - TOPBORDER - YBORDER - fontI.baseAdd;
}

export function addWavies(
	pt1: Point,
	pt2: Point,
	pts: Point[],
	waveDiam: number,
	interval: number,
): void {
	const dist = pointDist(pt1, pt2);
	const nWaves = dist / interval;
	if (nWaves < 2) return;
	const iWaves = Math.trunc(nWaves);
	const waveLen = dist / iWaves;
	const unitVec = dpointScalmult(
		1.0 / dist,
		dpointSub(pointToDpoint(pt2), pointToDpoint(pt1)),
	);
	const incVec = dpointToPoint(dpointScalmult(waveLen, unitVec));
	const normalVec: DPoint = { x: unitVec.y, y: -unitVec.x };
	const extraVec = dpointToPoint(dpointScalmult(waveDiam, normalVec));
	let thisBase = pt1;
	for (let i = 0; i < iWaves - 1; i++) {
		thisBase = {
			x: thisBase.x + incVec.x,
			y: thisBase.y + incVec.y,
		};
		if (!(i & 0x1))
			pts.push({ x: thisBase.x + extraVec.x, y: thisBase.y + extraVec.y });
		else pts.push(thisBase);
	}
}

export function createBalloonSpline(
	fInfo: FormatInfo,
	fontI: FontMetrics,
): SplinePoints {
	const { left, right } = getFilters(fInfo);
	const finalY = permuteFilters(fontI, left, right);
	let lastY = finalY;
	const pts: Point[] = [];

	for (let i = 0; i < left.length; i++) {
		const f = left[i];
		if (!f) break;
		const thisPoint: Point = { x: f.x, y: f.y };
		const prev = pts[pts.length - 1];
		if (i > 0 && prev)
			addWavies(prev, thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
		pts.push(thisPoint);
		const nextY = i === left.length - 1 ? finalY : (left[i + 1]?.y ?? finalY);
		const nextPoint: Point = { x: f.x, y: nextY };
		addWavies(thisPoint, nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
		pts.push(nextPoint);
	}

	for (let i = right.length - 1; i >= 0; i--) {
		const f = right[i];
		if (!f) break;
		const thisPoint: Point = { x: f.x, y: lastY };
		const prev = pts[pts.length - 1];
		if (prev) addWavies(prev, thisPoint, pts, HWAVEHEIGHT, HWAVEINTERVAL);
		pts.push(thisPoint);
		const nextPoint: Point = { x: f.x, y: f.y };
		lastY = f.y;
		addWavies(thisPoint, nextPoint, pts, VWAVEHEIGHT, VWAVEINTERVAL);
		pts.push(nextPoint);
	}

	const prev = pts[pts.length - 1];
	const first = pts[0];
	if (prev && first) addWavies(prev, first, pts, HWAVEHEIGHT, HWAVEINTERVAL);

	return { closed: true, cps: pts };
}
