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
		expect(calls).toHaveLength(6);
		const pose = manifest.avatars[0]?.poses[0];
		if (!pose) throw new Error("fixture has no pose");
		expect(cache.get(pose)).toBe(image);
		cache.dispose();
		expect(closes).toBe(6);
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
});
