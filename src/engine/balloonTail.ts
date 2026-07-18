// Port of the balloon tail half of balloon.cpp: BreakSpline, AddArrow, box traj, cloud bbox.

import { createBalloonSpline } from "./balloonSpline.js";
import type { FontMetrics, FormatInfo } from "./balloonText.js";
import { includePtInBboxShort, makeEmptyShort, type Rect } from "./bbox.js";
import { BetaSpline, type Spline } from "./spline.js";
import {
	PI,
	type Point,
	pointDist,
	pointSub,
	vectorToAngle,
} from "./vector2d.js";

export const LARGEDELTA = 350;
export const SMALLDELTA = 150;
export const MINTAILHEIGHT = 100;
export const XBOXDELTA = 90;
export const YBOXDELTA = 50;

export interface Arc {
	lo: Point;
	hi: Point;
	altitude: number;
}

export interface LineSeg {
	lo: Point;
	hi: Point;
}

// x and y are in balloon space; the C also took an unused balloon param
export function breakSpline(
	spline: Spline,
	x: number,
	y: number,
	oFactor: number,
): void {
	const nCps = spline.nCps;
	const gapwidth = Math.trunc(80 * oFactor) | 0;
	const left: Point = { x: x - gapwidth, y };
	const { pos: leftNearest, knotIndex: leftKnotIndex } =
		spline.closestPoint(left);
	const { pt: rightNearest, foundKnotIndex: rightKnotIndex } =
		spline.walkHorizontalDistance(
			leftNearest,
			leftKnotIndex,
			leftNearest.x + 2 * gapwidth,
		);

	const newCps: Point[] = new Array(nCps + 2);
	newCps[0] = rightNearest;
	for (let i = 1; i <= nCps; i++)
		newCps[i] = spline.cpAt((rightKnotIndex + i - 2 + nCps) % nCps);
	const nCpsNew = nCps + 2 - ((rightKnotIndex - leftKnotIndex + nCps) % nCps);
	newCps[nCpsNew - 1] = leftNearest;

	spline.cps = newCps.slice(0, nCpsNew);
	spline.nCps = nCpsNew;
	spline.bezpts = null;
	spline.closed = false;
	spline.computeBezpts();
}

export interface ArrowContext {
	speakerArrowX: number;
	speakerTop: number;
	balloonLeft: number;
	balloonTop: number;
	routeLeft: number;
	routeRight: number;
	cloudBottom: number;
}

export function addArrow(
	spline: Spline,
	fInfo: FormatInfo,
	ctx: ArrowContext,
): [Arc, Arc] {
	const bottom2: Point = { x: ctx.speakerArrowX, y: ctx.speakerTop + 200 };
	const bottom: Point = {
		x: bottom2.x - ctx.balloonLeft,
		y: bottom2.y - ctx.balloonTop,
	};

	let xbreak =
		Math.trunc((ctx.routeLeft + ctx.routeRight) / 2) - ctx.balloonLeft;
	const bottomStart = fInfo.leftX[fInfo.nLines - 1] ?? 0;
	const bottomEnd = bottomStart + (fInfo.lines[fInfo.nLines - 1]?.width ?? 0);

	if (
		xbreak < bottomStart &&
		bottomStart + ctx.balloonLeft < ctx.routeRight - LARGEDELTA
	)
		xbreak = bottomStart + SMALLDELTA;
	else if (
		xbreak > bottomEnd &&
		bottomEnd + ctx.balloonLeft > ctx.routeLeft + LARGEDELTA
	)
		xbreak = bottomEnd - SMALLDELTA;

	const top2: Point = { x: xbreak + ctx.balloonLeft, y: ctx.cloudBottom };
	if (top2.y - bottom2.y < MINTAILHEIGHT) {
		bottom2.y = top2.y - MINTAILHEIGHT;
		bottom.y = bottom2.y - ctx.balloonTop;
	}

	let ang = vectorToAngle(pointSub(top2, bottom2));
	// limit the tail angle to 45 degrees from vertical, using the imprecise PI
	if (Math.abs(ang) - PI / 2.0 > PI / 4.0) {
		if (ang > (3.0 * PI) / 4.0) ang = (3.0 * PI) / 4.0;
		else ang = PI / 4.0;
		const heightDelta = top2.y - bottom2.y;
		xbreak =
			Math.trunc(Math.cos(ang) * heightDelta + bottom2.x - ctx.balloonLeft) | 0;
	}

	const oFactor = 1.0;
	breakSpline(spline, xbreak, fInfo.fbox.bottom, oFactor);

	const left = spline.cpAt(spline.nCps - 1);
	const right = spline.cpAt(0);
	top2.y = Math.trunc((left.y + right.y) / 2) + ctx.balloonTop;
	top2.x = Math.trunc((left.x + right.x) / 2) + ctx.balloonLeft;

	const tailLen = Math.trunc(pointDist(top2, bottom2)) | 0;
	const alt = Math.trunc(0.05 * tailLen) | 0;
	const sign = bottom.x > left.x ? 1 : -1;
	return [
		{ lo: left, hi: bottom, altitude: sign * alt },
		{ lo: bottom, hi: right, altitude: -sign * alt },
	];
}

export interface BalloonTraj {
	spline: Spline;
	arcs: Arc[];
	lines: LineSeg[];
	closed: boolean;
}

// CBWoodringNormal::SetBalloonTraj: clone the closed spline, break it open, add the tail arcs
export function normalBalloonTraj(
	fInfo: FormatInfo,
	fontI: FontMetrics,
	ctx: ArrowContext,
): BalloonTraj {
	const pts = createBalloonSpline(fInfo, fontI);
	const spline = new BetaSpline(pts.cps, pts.cps.length, true);
	const arcs = addArrow(spline, fInfo, ctx);
	return { spline, arcs: [arcs[0], arcs[1]], lines: [], closed: true };
}

// CBWoodringBox::SetBalloonTraj: a plain rectangle around the format box
export function boxBalloonTraj(
	fbox: Rect,
): [LineSeg, LineSeg, LineSeg, LineSeg] {
	const pt1: Point = { x: fbox.left - XBOXDELTA, y: fbox.bottom - YBOXDELTA };
	const pt2: Point = { x: pt1.x, y: fbox.top + YBOXDELTA };
	const pt3: Point = { x: fbox.right + XBOXDELTA, y: pt2.y };
	const pt4: Point = { x: pt3.x, y: pt1.y };
	return [
		{ lo: pt1, hi: pt2 },
		{ lo: pt2, hi: pt3 },
		{ lo: pt3, hi: pt4 },
		{ lo: pt4, hi: pt1 },
	];
}

export function computeCloudBBox(cps: Point[]): Rect {
	const trueBox: Rect = { left: 0, bottom: 0, right: 0, top: 0 };
	makeEmptyShort(trueBox);
	for (const pt of cps) includePtInBboxShort(pt, trueBox);
	return trueBox;
}

export function boxCloudBBox(fbox: Rect): Rect {
	return {
		left: fbox.left - XBOXDELTA,
		right: fbox.right + XBOXDELTA,
		bottom: fbox.bottom - YBOXDELTA,
		top: fbox.top + YBOXDELTA,
	};
}
