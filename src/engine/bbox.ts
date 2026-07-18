// Port of bbox.h/bbox.cpp; rects are Y-up, so bottom holds the min and top the max.

import { LARGEINTEGER, LARGESHORT, type Point } from "./vector2d.js";

export interface Rect {
	left: number;
	bottom: number;
	right: number;
	top: number;
}

function toShort(x: number): number {
	return (x << 16) >> 16;
}

export function adjustBbox(bbox: Rect, delta: number): void {
	bbox.left -= delta;
	bbox.bottom -= delta;
	bbox.right += delta;
	bbox.top += delta;
}

export function bboxAroundPt(bbox: Rect, pt: Point, delta = 0): void {
	bbox.left = pt.x;
	bbox.right = pt.x;
	bbox.top = pt.y;
	bbox.bottom = pt.y;
	if (delta) adjustBbox(bbox, delta);
}

export function bboxInBbox(source: Rect, dest: Rect): void {
	dest.left = Math.min(source.left, dest.left);
	dest.bottom = Math.min(source.bottom, dest.bottom);
	dest.right = Math.max(source.right, dest.right);
	dest.top = Math.max(source.top, dest.top);
}

export function includePtInBbox(pt: Point, bbox: Rect): void {
	bbox.left = Math.min(pt.x, bbox.left);
	bbox.bottom = Math.min(pt.y, bbox.bottom);
	bbox.right = Math.max(pt.x, bbox.right);
	bbox.top = Math.max(pt.y, bbox.top);
}

// SRECT overload: results pass through a C short cast
export function includePtInBboxShort(pt: Point, bbox: Rect): void {
	bbox.left = toShort(Math.min(pt.x, bbox.left));
	bbox.bottom = toShort(Math.min(pt.y, bbox.bottom));
	bbox.right = toShort(Math.max(pt.x, bbox.right));
	bbox.top = toShort(Math.max(pt.y, bbox.top));
}

export function insideBbox(pt: Point, bbox: Rect): boolean {
	return (
		pt.x >= bbox.left &&
		pt.x <= bbox.right &&
		pt.y >= bbox.bottom &&
		pt.y <= bbox.top
	);
}

export function insideBboxTol(pt: Point, bbox: Rect, tol: number): boolean {
	return (
		pt.x + tol >= bbox.left &&
		pt.x - tol <= bbox.right &&
		pt.y + tol >= bbox.bottom &&
		pt.y - tol <= bbox.top
	);
}

export function bboxOverlap(bbox1: Rect, bbox2: Rect): boolean {
	return !(
		bbox1.left > bbox2.right ||
		bbox2.left > bbox1.right ||
		bbox1.bottom > bbox2.top ||
		bbox2.bottom > bbox1.top
	);
}

// faithful bug from bbox.cpp:76: pt2.y reads bbox2's bottom, not bbox1's
export function bboxWithinBbox(bbox1: Rect, bbox2: Rect): boolean {
	const pt1 = { x: bbox1.right, y: bbox1.top };
	const pt2 = { x: bbox1.left, y: bbox2.bottom };
	return insideBboxTol(pt1, bbox2, 0) && insideBboxTol(pt2, bbox2, 0);
}

export function isEmpty(bbox: Rect): boolean {
	return bbox.left > bbox.right || bbox.bottom > bbox.top;
}

export function makeEmpty(bbox: Rect): void {
	bbox.left = LARGEINTEGER;
	bbox.bottom = LARGEINTEGER;
	bbox.right = -LARGEINTEGER;
	bbox.top = -LARGEINTEGER;
}

export function makeEmptyShort(bbox: Rect): void {
	bbox.left = LARGESHORT;
	bbox.bottom = LARGESHORT;
	bbox.right = -LARGESHORT;
	bbox.top = -LARGESHORT;
}

// returns TRUE when the intersection is empty, matching the C original
export function bboxIntersect(bbox1: Rect, bbox2: Rect, result: Rect): boolean {
	result.left = Math.max(bbox1.left, bbox2.left);
	result.right = Math.min(bbox1.right, bbox2.right);
	result.top = Math.min(bbox1.top, bbox2.top);
	result.bottom = Math.max(bbox1.bottom, bbox2.bottom);
	return isEmpty(result);
}
