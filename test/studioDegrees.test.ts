import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { EM_HAPPY } from "../src/engine/emotion.js";
import { emotionDegreeCache, emotionDegrees } from "../src/studio/degrees.js";
import { buildCatalog, emotionAngles } from "../src/studio/script.js";

interface FixtureFile {
	avatars: AvatarData[];
}

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as FixtureFile;

const avatarOf = (name: string) => {
	const registry = new AvatarRegistry(fixture.avatars);
	const avatar = registry.avatars.find((entry) => entry.data.name === name);
	if (!avatar) throw new Error(`missing fixture avatar: ${name}`);
	return avatar;
};

// the same pose key the probe dedupes on, rebuilt here so the test does not trust the probe's own bookkeeping
function poseOf(name: string, angle: number, intensity: number): string {
	const avatar = avatarOf(name);
	const body = avatar.getBodyFromEmotion(angle, intensity);
	return body.kind === "simple"
		? `${avatar.data.bodies[body.bodyIndex]?.poseID}`
		: `${avatar.data.faces[body.faceIndex]?.poseID}/${
				avatar.data.torsos[body.torsoIndex]?.poseID
			}`;
}

describe("emotionDegrees", () => {
	it("gives anna two distinct happy poses rather than a fixed three", () => {
		const degrees = emotionDegrees(avatarOf("anna"), EM_HAPPY);
		expect(degrees).toHaveLength(2);
		expect(poseOf("anna", EM_HAPPY, degrees[0] ?? 0)).not.toBe(
			poseOf("anna", EM_HAPPY, degrees[1] ?? 0),
		);
	});

	it("returns ascending intensities inside the wheel's range", () => {
		for (const [, angle] of emotionAngles()) {
			for (const name of ["anna", "bolo", "connor"]) {
				const degrees = emotionDegrees(avatarOf(name), angle);
				expect(degrees).toEqual([...degrees].sort((a, b) => a - b));
				for (const degree of degrees) {
					expect(degree).toBeGreaterThan(0);
					expect(degree).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	it("never repeats a pose, and never offers the neutral drawing as an emotion", () => {
		for (const [, angle] of emotionAngles()) {
			for (const data of fixture.avatars) {
				const neutral = poseOf(data.name, 0, 0);
				const poses = emotionDegrees(avatarOf(data.name), angle).map((degree) =>
					poseOf(data.name, angle, degree),
				);
				expect(new Set(poses).size).toBe(poses.length);
				expect(poses).not.toContain(neutral);
			}
		}
	});
});

describe("emotionDegreeCache", () => {
	it("covers every avatar and omits emotions the character cannot express", () => {
		const degreesOf = emotionDegreeCache(fixture.avatars, emotionAngles());
		for (const data of fixture.avatars)
			for (const steps of Object.values(degreesOf(data.name)))
				expect(steps.length).toBeGreaterThan(0);
	});

	it("hands back the same object on a second ask, and nothing for a stranger", () => {
		const degreesOf = emotionDegreeCache(fixture.avatars, emotionAngles());
		expect(degreesOf("anna")).toBe(degreesOf("anna"));
		expect(degreesOf("nobody")).toEqual({});
	});

	it("reaches the catalog, so the editor can offer per-character degrees", () => {
		const catalog = buildCatalog(fixture.avatars, []);
		const anna = catalog.avatars.find((entry) => entry.name === "anna");
		expect(anna?.degrees.happy).toHaveLength(2);
		expect(anna?.degrees.neutral).toBeUndefined();
	});
});
