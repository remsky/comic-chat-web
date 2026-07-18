import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";

const manifest = JSON.parse(
	readFileSync(
		new URL("../public/assets/avatars/manifest.json", import.meta.url),
		"utf8",
	),
) as { avatars: AvatarData[]; poseCount: number };

function pngSize(bytes: Uint8Array): { width: number; height: number } {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("avatar web atlases", () => {
	it("packs every runtime pose into one valid atlas per avatar", () => {
		let poseCount = 0;
		const atlasUrls = new Set<string>();
		for (const avatar of manifest.avatars) {
			expect(avatar.flags).toBeTypeOf("number");
			const urls = new Set(
				avatar.poses.map((pose) => pose.sprite?.atlasUrl).filter(Boolean),
			);
			expect(urls.size, avatar.name).toBe(1);
			const atlasUrl = [...urls][0];
			if (!atlasUrl) continue;
			atlasUrls.add(atlasUrl);
			const atlasPath = new URL(`../public${atlasUrl}`, import.meta.url);
			expect(existsSync(atlasPath), avatar.name).toBe(true);
			const bytes = new Uint8Array(readFileSync(atlasPath));
			const size = pngSize(bytes);
			for (const pose of avatar.poses) {
				expect(pose.sprite, `${avatar.name} pose ${pose.poseID}`).toBeDefined();
				if (!pose.sprite) continue;
				expect(pose.sprite.x).toBeGreaterThanOrEqual(0);
				expect(pose.sprite.y).toBeGreaterThanOrEqual(0);
				expect(pose.sprite.x + pose.width).toBeLessThanOrEqual(size.width);
				expect(pose.sprite.y + pose.height).toBeLessThanOrEqual(size.height);
				poseCount++;
			}
		}
		expect(atlasUrls.size).toBe(6);
		expect(poseCount).toBe(manifest.poseCount);
	});
});
