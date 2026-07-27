import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AvatarAtlasCache } from "../src/browser/avatarAssets.js";
import {
	bodySpriteLayers,
	CanvasPanelRenderer,
} from "../src/browser/canvasRenderer.js";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { bodyFromPoseIDs, type UnitPanel } from "../src/engine/panel.js";

const manifest = JSON.parse(
	readFileSync(
		new URL("../public/assets/avatars/manifest.json", import.meta.url),
		"utf8",
	),
) as { avatars: AvatarData[] };

describe("avatar atlas cache", () => {
	it("deduplicates loads, exposes decoded images synchronously, and disposes", async () => {
		const calls: string[] = [];
		let closes = 0;
		const image = { close: () => closes++ } as unknown as CanvasImageSource & {
			close(): void;
		};
		const cache = new AvatarAtlasCache(async (url) => {
			calls.push(url);
			return image;
		});
		await Promise.all([
			cache.preload(manifest.avatars),
			cache.preload(manifest.avatars),
		]);
		expect(calls).toHaveLength(manifest.avatars.length);
		const pose = manifest.avatars[0]?.poses[0];
		if (!pose) throw new Error("fixture has no pose");
		expect(cache.get(pose)).toBe(image);
		cache.dispose();
		expect(closes).toBe(manifest.avatars.length);
	});
});

describe("canvas avatar composition", () => {
	it("preserves v1 torso-first layering and horizontal flip rectangles", () => {
		const registry = new AvatarRegistry(manifest.avatars);
		const avatar = registry.get(1);
		if (!avatar) throw new Error("missing Anna");
		const body = bodyFromPoseIDs(avatar.data, 2, 13);
		body.bbox = { left: 406, bottom: -2300, right: 942, top: -1090 };
		const layers = bodySpriteLayers(avatar, body);
		expect(layers.map((layer) => layer.pose.poseID)).toEqual([13, 2]);
		for (const layer of layers) {
			expect(Math.min(layer.left, layer.right)).toBeGreaterThanOrEqual(
				body.bbox.left,
			);
			expect(Math.max(layer.left, layer.right)).toBeLessThanOrEqual(
				body.bbox.right + 1,
			);
		}
		body.flip = true;
		expect(
			bodySpriteLayers(avatar, body).every((layer) => layer.left > layer.right),
		).toBe(true);
	});

	it("draws atlas source rectangles in body order before the panel border", async () => {
		const registry = new AvatarRegistry(manifest.avatars);
		const avatar = registry.get(1);
		if (!avatar) throw new Error("missing Anna");
		const body = bodyFromPoseIDs(avatar.data, 2, 13);
		body.bbox = { left: 406, bottom: -2300, right: 942, top: -1090 };
		const calls: { name: string; args: unknown[] }[] = [];
		const context = new Proxy(
			{
				fillStyle: "",
				strokeStyle: "",
				lineWidth: 0,
				imageSmoothingEnabled: false,
				imageSmoothingQuality: "low",
			},
			{
				get(target, property) {
					if (property in target)
						return target[property as keyof typeof target];
					return (...args: unknown[]) => {
						calls.push({ name: String(property), args });
					};
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const cache = new AvatarAtlasCache(async () => ({}) as CanvasImageSource);
		await cache.preload(manifest.avatars);
		const renderer = new CanvasPanelRenderer(context, cache, registry.avatars, {
			unitWidth: 2300,
			unitHeight: 5400,
		});
		const panel: UnitPanel = {
			seed: 4985,
			hasBorder: true,
			backdropMode: 0,
			bodies: [body],
			balloons: [],
		};
		renderer.render(panel);
		const drawCalls = calls.filter((call) => call.name === "drawImage");
		expect(drawCalls).toHaveLength(2);
		expect(drawCalls.map((call) => call.args.slice(1, 5))).toEqual(
			bodySpriteLayers(avatar, body).map((layer) => [
				layer.pose.sprite?.x,
				layer.pose.sprite?.y,
				layer.pose.width,
				layer.pose.height,
			]),
		);
		expect(calls.at(-2)?.name).toBe("strokeRect");
	});

	it("draws a title card as text and cast icons instead of bodies", async () => {
		const registry = new AvatarRegistry(manifest.avatars);
		const anna = registry.get(1);
		if (!anna) throw new Error("missing Anna");
		const calls: { name: string; args: unknown[] }[] = [];
		const context = new Proxy(
			{
				fillStyle: "",
				strokeStyle: "",
				font: "",
				textAlign: "left",
				textBaseline: "alphabetic",
				lineWidth: 0,
				imageSmoothingEnabled: false,
				imageSmoothingQuality: "low",
				measureText: (text: string) => ({
					width: text.length * 150,
					fontBoundingBoxAscent: 300,
					fontBoundingBoxDescent: 100,
				}),
			},
			{
				get(target, property) {
					if (property in target)
						return target[property as keyof typeof target];
					return (...args: unknown[]) => {
						calls.push({ name: String(property), args });
					};
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const cache = new AvatarAtlasCache(async () => ({}) as CanvasImageSource);
		await cache.preload(manifest.avatars);
		const renderer = new CanvasPanelRenderer(context, cache, registry.avatars, {
			unitWidth: 3000,
			unitHeight: 3000,
		});
		const panel: UnitPanel = {
			seed: 0,
			hasBorder: false,
			backdropMode: 0,
			bodies: [],
			balloons: [],
			title: {
				text: "NO EXIT",
				stars: [{ avatarID: 1, label: "anna" }],
			},
		};
		renderer.render(panel);
		const texts = calls
			.filter((call) => call.name === "fillText")
			.map((call) => call.args[0]);
		expect(texts).toEqual(["NO EXIT", "STARRING", "anna"]);
		const icon = anna.data.poses.find(
			(pose) => pose.poseID === anna.data.iconPoseID,
		);
		const drawCalls = calls.filter((call) => call.name === "drawImage");
		expect(drawCalls).toHaveLength(1);
		expect(drawCalls[0]?.args.slice(1, 5)).toEqual([
			icon?.sprite?.x,
			icon?.sprite?.y,
			icon?.width,
			icon?.height,
		]);
		expect(calls.some((call) => call.name === "strokeRect")).toBe(false);
	});

	it("drops the line under a descender and takes a written starring line", async () => {
		const registry = new AvatarRegistry(manifest.avatars);
		const cache = new AvatarAtlasCache(async () => ({}) as CanvasImageSource);
		await cache.preload(manifest.avatars);
		const draw = (text: string, starring?: string) => {
			const lines: { text: string; y: number }[] = [];
			const context = new Proxy(
				{
					fillStyle: "",
					font: "",
					textAlign: "left",
					textBaseline: "alphabetic",
					measureText: (probe: string) => ({
						width: probe.length * 150,
						fontBoundingBoxAscent: 300,
						fontBoundingBoxDescent: 100,
						// the baseline sits 300 under a "top" origin, so a tail reaches 380
						actualBoundingBoxDescent: /[gjpqy]/.test(probe) ? 380 : 300,
					}),
					fillText: (probe: string, _x: number, y: number) =>
						lines.push({ text: probe, y }),
				},
				{
					get(target, property) {
						if (property in target)
							return target[property as keyof typeof target];
						return () => {};
					},
				},
			) as unknown as CanvasRenderingContext2D;
			const renderer = new CanvasPanelRenderer(
				context,
				cache,
				registry.avatars,
				{ unitWidth: 3000, unitHeight: 3000 },
			);
			renderer.render({
				seed: 0,
				hasBorder: false,
				backdropMode: 0,
				bodies: [],
				balloons: [],
				title: {
					text,
					...(starring ? { starring } : {}),
					stars: [{ avatarID: 1, label: "anna" }],
				},
			});
			return lines;
		};

		const caps = draw("NO EXIT");
		const hung = draw("Digging");
		expect(caps.map((line) => line.text)).toEqual([
			"NO EXIT",
			"STARRING",
			"anna",
		]);
		expect(caps[0]?.y).toBe(hung[0]?.y);
		expect((hung[1]?.y ?? 0) - (caps[1]?.y ?? 0)).toBe(80);
		expect(draw("NO EXIT", "TOLD BY").map((line) => line.text)).toEqual([
			"NO EXIT",
			"TOLD BY",
			"anna",
		]);
	});
});
