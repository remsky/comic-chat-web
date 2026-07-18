// Port of vector2d.h/vector2d.cpp; Point carries C int semantics, DPoint is double.

export interface DPoint {
	x: number;
	y: number;
}

export interface Point {
	x: number;
	y: number;
}

export const LARGENUMBER = 1e24;
export const SMALLNUMBER = 1e-24;
export const LARGEINTEGER = 100000000;
export const LARGESHORT = 31000;

// biome-ignore lint/suspicious/noApproximativeNumericConstant: vector2d.h defines PI as 3.14159; the oracle depends on the imprecision
export const PI = 3.14159;

// C's ROUND is (int)(fp + 0.5), which truncates, so negatives round toward zero
export function round(fp: number): number {
	return Math.trunc(fp + 0.5) | 0;
}

export function dpointSub(pt1: DPoint, pt2: DPoint): DPoint {
	return { x: pt1.x - pt2.x, y: pt1.y - pt2.y };
}

export function dpointAdd(pt1: DPoint, pt2: DPoint): DPoint {
	return { x: pt1.x + pt2.x, y: pt1.y + pt2.y };
}

export function dpointScalmult(scalar: number, pt: DPoint): DPoint {
	return { x: pt.x * scalar, y: pt.y * scalar };
}

export function dpointDot(pt1: DPoint, pt2: DPoint): number {
	return pt1.x * pt2.x + pt1.y * pt2.y;
}

export function dpointDist(pt1: DPoint, pt2: DPoint): number {
	const diffx = pt1.x - pt2.x;
	const diffy = pt1.y - pt2.y;
	return Math.sqrt(diffx * diffx + diffy * diffy);
}

export function dpointDistsq(pt1: DPoint, pt2: DPoint): number {
	const diffx = pt1.x - pt2.x;
	const diffy = pt1.y - pt2.y;
	return diffx * diffx + diffy * diffy;
}

export function dpointMagn(pt: DPoint): number {
	return Math.sqrt(pt.x * pt.x + pt.y * pt.y);
}

export function dpointNorm(pt: DPoint): DPoint {
	const magn = dpointMagn(pt);
	if (magn < SMALLNUMBER) return { x: 0, y: 0 };
	return dpointScalmult(1 / magn, pt);
}

export function pointSub(pt1: Point, pt2: Point): Point {
	return { x: pt1.x - pt2.x, y: pt1.y - pt2.y };
}

export function pointAdd(pt1: Point, pt2: Point): Point {
	return { x: pt1.x + pt2.x, y: pt1.y + pt2.y };
}

export function pointScalmult(scalar: number, pt: Point): Point {
	return { x: Math.trunc(pt.x * scalar) | 0, y: Math.trunc(pt.y * scalar) | 0 };
}

export function pointDot(pt1: Point, pt2: Point): number {
	return pt1.x * pt2.x + pt1.y * pt2.y;
}

export function pointDist(pt1: Point, pt2: Point): number {
	return dpointDist(pt1, pt2);
}

export function pointDistsq(pt1: Point, pt2: Point): number {
	return dpointDistsq(pt1, pt2);
}

export function manhattanDist(pt1: Point, pt2: Point): number {
	return Math.abs(pt1.x - pt2.x) + Math.abs(pt1.y - pt2.y);
}

export function pointMagn(pt: Point): number {
	return Math.sqrt(pt.x * pt.x + pt.y * pt.y);
}

export function pointNorm(pt: Point): Point {
	const magn = pointMagn(pt);
	if (magn < SMALLNUMBER) return { x: 0, y: 0 };
	return pointScalmult(1 / magn, pt);
}

export function vectorToAngle(vec: DPoint): number {
	if (Math.abs(vec.x) < SMALLNUMBER && Math.abs(vec.y) < SMALLNUMBER) return 0;
	return Math.atan2(vec.y, vec.x);
}

export function pointToDpoint(pt: Point): DPoint {
	return { x: pt.x, y: pt.y };
}

export function dpointToPoint(dpt: DPoint): Point {
	return { x: round(dpt.x), y: round(dpt.y) };
}

export function degreesToRads(degrees: number): number {
	return degrees * (PI / 180.0);
}

export function angleToVector(angle: number): DPoint {
	return { x: Math.cos(angle), y: Math.sin(angle) };
}

// converts to an angle in (-180, 180]
export function valueToAngle(value: number): number {
	if (value > -PI && value <= PI) return value;
	let temp = value / (2 * PI);
	temp = (temp - Math.trunc(temp)) * 2 * PI;
	if (temp > PI) return temp - 2 * PI;
	if (temp <= -PI) return temp + 2 * PI;
	return temp;
}

export function addAngles(angle1: number, angle2: number): number {
	return valueToAngle(angle1 + angle2);
}

export function subtractAngles(angle1: number, angle2: number): number {
	return valueToAngle(angle1 - angle2);
}

export function angleBetweenVecs(vec1: DPoint, vec2: DPoint): number {
	return subtractAngles(vectorToAngle(vec2), vectorToAngle(vec1));
}
