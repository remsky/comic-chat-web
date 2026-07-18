import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrace, recordsOfType } from "../src/trace/format.js";
import type { AvatarFixtureSet } from "../tools/avb/fixtures.ts";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as AvatarFixtureSet;

describe("six-avatar runtime fixture", () => {
	it("uses trace cast order and v1 global pose numbering", () => {
		expect(fixture.castOrder).toEqual([
			"anna",
			"bolo",
			"connor",
			"denise",
			"hugh",
			"susan",
		]);
		expect(fixture.poseCount).toBe(126);
		expect(fixture.avatars.map((avatar) => avatar.iconPoseID)).toEqual([
			1, 23, 42, 55, 76, 96,
		]);
	});

	it("contains positive drawing dimensions for every registered pose", () => {
		for (const avatar of fixture.avatars) {
			for (const pose of avatar.poses) {
				expect(
					pose.width,
					`${avatar.name} pose ${pose.poseID} width`,
				).toBeGreaterThan(0);
				expect(
					pose.height,
					`${avatar.name} pose ${pose.poseID} height`,
				).toBeGreaterThan(0);
			}
		}
	});

	it("owns every positive pose ID emitted by the oracle traces", () => {
		const traceNames = readdirSync(
			new URL("../traces/", import.meta.url),
		).filter((name) => name.endsWith(".jsonl"));
		for (const name of traceNames) {
			const records = parseTrace(
				readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
			);
			for (const body of recordsOfType(records, "body")) {
				const avatar = fixture.avatars[body.avatarId - 1];
				expect(avatar, `${name} avatar ${body.avatarId}`).toBeDefined();
				if (!avatar) continue;
				const poseIDs = new Set(avatar.poses.map((pose) => pose.poseID));
				for (const poseID of [body.poseFace, body.poseTorso]) {
					if (poseID > 0) {
						expect(
							poseIDs.has(poseID),
							`${name} ${avatar.name} pose ${poseID}`,
						).toBe(true);
					}
				}
			}
		}
	});

	it("stores oracle float32 emotions and intensities", () => {
		const anna = fixture.avatars[0];
		expect(anna).toBeDefined();
		if (!anna) return;
		expect(
			anna.faces.some((face) => face.emotion === Math.fround(4.712385)),
		).toBe(true);
		for (const face of anna.faces) {
			expect(Math.fround(face.intensity)).toBe(face.intensity);
		}
	});
});
