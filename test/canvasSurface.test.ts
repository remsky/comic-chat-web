import { describe, expect, it } from "vitest";
import {
	CanvasSurface,
	canvasBackingStoreSize,
} from "../src/browser/canvasSurface.js";
import { panelAccessibleLabel } from "../src/browser/panelAccessibility.js";
import type { UnitPanel } from "../src/engine/panel.js";

describe("DPR-aware canvas surface", () => {
	it("caps device pixels while preserving the observed CSS size", () => {
		expect(canvasBackingStoreSize(500, 300, 3, 2)).toEqual({
			width: 1000,
			height: 600,
			dpr: 2,
		});
		expect(canvasBackingStoreSize(0, 0, 0.5)).toEqual({
			width: 1,
			height: 1,
			dpr: 1,
		});
	});

	it("coalesces invalidations into one frame and applies logical scaling", () => {
		const transforms: number[][] = [];
		const context = {
			setTransform: (...values: number[]) => transforms.push(values),
		};
		const canvas = {
			width: 0,
			height: 0,
			style: { aspectRatio: "", width: "", height: "" },
			getContext: () => context,
		} as unknown as HTMLCanvasElement;
		let observerCallback: ResizeObserverCallback | undefined;
		let frameCallback: FrameRequestCallback | undefined;
		let draws = 0;
		const surface = new CanvasSurface(canvas, 2300, 5400, () => draws++, {
			getDevicePixelRatio: () => 2,
			requestFrame: (callback) => {
				frameCallback = callback;
				return 1;
			},
			cancelFrame: () => {},
			createObserver: (callback) => {
				observerCallback = callback;
				return {
					observe: () => {},
					disconnect: () => {},
				} as unknown as ResizeObserver;
			},
		});
		surface.resize(230, 540);
		expect(canvas.width).toBe(460);
		expect(canvas.height).toBe(1080);
		expect(draws).toBe(1);
		expect(transforms).toEqual([[0.2, 0, 0, 0.2, 0, 0]]);

		surface.invalidate();
		surface.invalidate();
		expect(draws).toBe(1);
		expect(frameCallback).toBeDefined();
		frameCallback?.(0);
		expect(draws).toBe(2);

		surface.resize(230, 540);
		expect(draws).toBe(2);
		frameCallback?.(0);
		expect(draws).toBe(3);
		expect(observerCallback).toBeDefined();
		surface.dispose();
	});

	it("repaints synchronously when sizing clears the bitmap", () => {
		const context = { setTransform: () => {} };
		const canvas = {
			width: 0,
			height: 0,
			style: { aspectRatio: "", width: "", height: "" },
			getContext: () => context,
		} as unknown as HTMLCanvasElement;
		let draws = 0;
		const surface = new CanvasSurface(canvas, 2300, 5400, () => draws++, {
			getDevicePixelRatio: () => 1,
			requestFrame: () => 1,
			cancelFrame: () => {},
			createObserver: () =>
				({
					observe: () => {},
					disconnect: () => {},
				}) as unknown as ResizeObserver,
		});
		surface.resize(230, 540);
		expect(draws).toBe(1);
		surface.dispose();
	});

	it("settles ready when disposed before any draw", async () => {
		const canvas = {
			width: 0,
			height: 0,
			style: { aspectRatio: "", width: "", height: "" },
			getContext: () => ({ setTransform: () => {} }),
		} as unknown as HTMLCanvasElement;
		const surface = new CanvasSurface(canvas, 2300, 5400, () => {}, {
			getDevicePixelRatio: () => 1,
			requestFrame: () => 1,
			cancelFrame: () => {},
			createObserver: () =>
				({
					observe: () => {},
					disconnect: () => {},
				}) as unknown as ResizeObserver,
		});
		surface.dispose();
		await surface.ready;
	});
});

describe("panel accessibility", () => {
	it("exposes speaker names and dialogue independently of canvas pixels", () => {
		const speaker = {
			avatarID: 1,
			flip: false,
			requested: true,
			arrowX: 0,
			bbox: { left: 0, bottom: 0, right: 0, top: 0 },
			kind: "simple" as const,
			bodyIndex: 0,
		};
		const panel: UnitPanel = {
			seed: 1,
			hasBorder: true,
			backdropMode: 0,
			bodies: [speaker],
			balloons: [{ text: "HELLO", mode: 1, speaker }],
		};
		expect(
			panelAccessibleLabel(panel, [
				{
					avatarID: 1,
					name: "Anna",
					type: "simple",
					iconPoseID: 1,
					poses: [],
					faces: [],
					torsos: [],
					bodies: [],
				},
			]),
		).toBe("Comic panel. Anna: HELLO");
	});
});
