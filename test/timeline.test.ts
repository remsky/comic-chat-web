import { describe, expect, it } from "vitest";
import {
	balloonAlpha,
	HOLD_SECONDS,
	timelineAt,
	timelineDuration,
	XFADE_SECONDS,
} from "../src/studio/timeline.js";

const SPAN = HOLD_SECONDS - XFADE_SECONDS;

describe("timelineDuration", () => {
	it("holds a single panel for the full hold", () => {
		expect(timelineDuration(1)).toBe(HOLD_SECONDS);
	});

	it("overlaps each crossfade instead of stacking holds", () => {
		expect(timelineDuration(4)).toBeCloseTo(HOLD_SECONDS + 3 * SPAN);
	});
});

describe("timelineAt", () => {
	it("stays on the only panel with no blend", () => {
		const frame = timelineAt(HOLD_SECONDS - 0.1, 1);
		expect(frame.index).toBe(0);
		expect(frame.local).toBeCloseTo(HOLD_SECONDS - 0.1);
		expect(frame.blend).toBeUndefined();
	});

	it("blends the incoming panel halfway through the crossfade", () => {
		const frame = timelineAt(SPAN + XFADE_SECONDS / 2, 4);
		expect(frame.index).toBe(0);
		expect(frame.local).toBeCloseTo(SPAN + XFADE_SECONDS / 2);
		expect(frame.blend?.index).toBe(1);
		expect(frame.blend?.local).toBeCloseTo(XFADE_SECONDS / 2);
		expect(frame.blend?.alpha).toBeCloseTo(0.5);
	});

	it("never yields a negative local or an out of range alpha at frame times", () => {
		for (let count = 2; count <= 5; count++) {
			const frames = Math.round(timelineDuration(count) * 30);
			for (let i = 0; i < frames; i++) {
				const frame = timelineAt(i / 30, count);
				expect(frame.local).toBeGreaterThanOrEqual(0);
				if (frame.blend) {
					expect(frame.blend.local).toBeGreaterThanOrEqual(0);
					expect(frame.blend.alpha).toBeGreaterThanOrEqual(0);
					expect(frame.blend.alpha).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	it("runs the last panel to the end without a blend", () => {
		const frame = timelineAt(timelineDuration(2) - 0.01, 2);
		expect(frame.index).toBe(1);
		expect(frame.local).toBeCloseTo(HOLD_SECONDS - 0.01);
		expect(frame.blend).toBeUndefined();
	});
});

describe("balloonAlpha", () => {
	it("is hidden before the fade, halfway mid fade, solid after", () => {
		expect(balloonAlpha(0.5)).toBe(0);
		expect(balloonAlpha(0.775)).toBeCloseTo(0.5);
		expect(balloonAlpha(1.2)).toBe(1);
	});
});
