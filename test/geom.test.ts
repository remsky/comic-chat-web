import { describe, expect, it } from "vitest";
import {
	bboxInBbox,
	bboxIntersect,
	bboxOverlap,
	bboxWithinBbox,
	includePtInBbox,
	includePtInBboxShort,
	isEmpty,
	makeEmpty,
	type Rect,
} from "../src/engine/bbox.js";
import {
	dpointToPoint,
	PI,
	pointScalmult,
	round,
	subtractAngles,
	valueToAngle,
} from "../src/engine/vector2d.js";

describe("vector2d C semantics", () => {
	it("round truncates after adding 0.5, so negatives round toward zero", () => {
		expect(round(2.5)).toBe(3);
		expect(round(-2.5)).toBe(-2);
		expect(round(-2.6)).toBe(-2);
		expect(dpointToPoint({ x: -0.7, y: 1.5 })).toEqual({ x: 0, y: 2 });
	});

	it("integer point scaling truncates like a C int cast", () => {
		expect(pointScalmult(0.5, { x: 5, y: -5 })).toEqual({ x: 2, y: -2 });
	});

	it("valueToAngle wraps into (-PI, PI] using the imprecise PI", () => {
		expect(valueToAngle(3 * PI)).toBeCloseTo(PI, 10);
		expect(valueToAngle(-PI)).toBeCloseTo(PI, 10);
		expect(subtractAngles(0.5, 2 * PI + 0.5)).toBeCloseTo(0, 10);
	});
});

describe("bbox C semantics", () => {
	const rect = (
		left: number,
		bottom: number,
		right: number,
		top: number,
	): Rect => ({
		left,
		bottom,
		right,
		top,
	});

	it("makeEmpty produces an empty box that unions correctly", () => {
		const b = rect(0, 0, 0, 0);
		makeEmpty(b);
		expect(isEmpty(b)).toBe(true);
		includePtInBbox({ x: 3, y: -7 }, b);
		includePtInBbox({ x: -2, y: 5 }, b);
		expect(b).toEqual(rect(-2, -7, 3, 5));
		expect(isEmpty(b)).toBe(false);
	});

	it("bboxInBbox unions with Y-up bottom/top", () => {
		const dest = rect(0, 0, 10, 10);
		bboxInBbox(rect(-5, -5, 3, 20), dest);
		expect(dest).toEqual(rect(-5, -5, 10, 20));
	});

	it("short variant truncates through a 16 bit cast", () => {
		const b = rect(0, 0, 0, 0);
		includePtInBboxShort({ x: 40000, y: 0 }, b);
		expect(b.right).toBe(40000 - 65536);
	});

	it("bboxIntersect returns TRUE when the intersection is empty", () => {
		const result = rect(0, 0, 0, 0);
		expect(
			bboxIntersect(rect(0, 0, 10, 10), rect(20, 20, 30, 30), result),
		).toBe(true);
		expect(bboxIntersect(rect(0, 0, 10, 10), rect(5, 5, 30, 30), result)).toBe(
			false,
		);
		expect(result).toEqual(rect(5, 5, 10, 10));
	});

	it("overlap is inclusive of touching edges", () => {
		expect(bboxOverlap(rect(0, 0, 10, 10), rect(10, 10, 20, 20))).toBe(true);
		expect(bboxOverlap(rect(0, 0, 10, 10), rect(11, 0, 20, 10))).toBe(false);
	});

	it("preserves the bboxWithinBbox bug that tests bbox2's own bottom", () => {
		expect(bboxWithinBbox(rect(2, -50, 8, 8), rect(0, 0, 10, 10))).toBe(true);
	});
});
