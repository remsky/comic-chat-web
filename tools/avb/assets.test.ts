// Pins the shipped manifest to the source art: it may diverge only where artRepairs.ts says so.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ART_REPAIRS,
	applyArtRepairs,
	describeRepair,
	repairTargets,
} from "./artRepairs.ts";
import { castArtAvailable, readCastAvb } from "./castSource.ts";
import { appendCustomAvatars } from "./customAvatars.ts";
import {
	type AvatarFixtureSet,
	buildAvatarFixtures,
	FULL_CAST,
} from "./fixtures.ts";

const MANIFEST = fileURLToPath(
	new URL("../../public/assets/avatars/manifest.json", import.meta.url),
);

// suite needs the sibling trace-harness checkout; absent on CI
const hasCastArt = castArtAvailable();

function fromSource(): AvatarFixtureSet {
	const fixtures = buildAvatarFixtures(
		FULL_CAST.map((name) => ({ name, bytes: readCastAvb(name) })),
	);
	appendCustomAvatars(fixtures);
	return fixtures;
}

// the atlas packer stamps these onto the shipped copy; nothing upstream of it knows them
function stripSprites(fixtures: AvatarFixtureSet): AvatarFixtureSet {
	return {
		...fixtures,
		avatars: fixtures.avatars.map((avatar) => ({
			...avatar,
			poses: avatar.poses.map(({ sprite, ...pose }) => pose),
		})),
	};
}

describe.runIf(hasCastArt)("the shipped avatar manifest", () => {
	const shipped: AvatarFixtureSet = JSON.parse(readFileSync(MANIFEST, "utf8"));

	it("is the source art plus the declared repairs", () => {
		const rebuilt = fromSource();
		applyArtRepairs(rebuilt);
		expect(stripSprites(shipped)).toEqual(rebuilt);
	});

	it("carries a sprite for every pose", () => {
		for (const avatar of shipped.avatars)
			for (const pose of avatar.poses)
				expect(pose.sprite, `${avatar.name} pose ${pose.poseID}`).toBeDefined();
	});
});

describe.runIf(hasCastArt)("the declared art repairs", () => {
	it("each change a record the source art actually carries", () => {
		const fixtures = fromSource();
		applyArtRepairs(fixtures).forEach((applied, index) => {
			const repair = ART_REPAIRS[index];
			if (!repair) return;
			expect(
				applied,
				`${describeRepair(repair)} matched no record`,
			).toBeGreaterThan(0);
		});
	});

	it("each move the value away from what the source art ships", () => {
		const source = fromSource();
		const repaired = fromSource();
		applyArtRepairs(repaired);
		for (const repair of ART_REPAIRS) {
			const pick = (set: AvatarFixtureSet) =>
				repairTargets(set, repair)[0]?.[repair.field];
			expect(pick(repaired), describeRepair(repair)).toBe(repair.value);
			expect(
				pick(source),
				`${describeRepair(repair)} is already correct`,
			).not.toBe(repair.value);
		}
	});
});
