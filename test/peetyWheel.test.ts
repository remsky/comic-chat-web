import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, createAvatar } from "../src/engine/avatar.js";
import {
	EM_ANGRY,
	EM_BORED,
	EM_COY,
	EM_LAUGH,
	EM_NEUTRAL,
	EM_SHOUT,
} from "../src/engine/emotion.js";

const { avatars } = JSON.parse(
	readFileSync(
		new URL("../public/assets/avatars/manifest.json", import.meta.url),
		"utf8",
	),
) as { avatars: AvatarData[] };

const found = avatars.find((avatar) => avatar.name === "peety");
if (found?.type !== "complex") throw new Error("no peety in the manifest");
const peety = found;

// the drawing the wheel landed on, since one drawing carries both a gesture code and a ring emotion
function torsoPose(emotion: number, intensity: number): number | undefined {
	const body = createAvatar(peety).getBodyFromEmotion(emotion, intensity);
	if (body.kind !== "complex") throw new Error("peety is not complex");
	return peety.torsos[body.torsoIndex]?.poseID;
}

const NEUTRAL_POSE = 567;

describe("Peety's emotion wheel", () => {
	it.each([
		["laugh", EM_LAUGH],
		["shout", EM_SHOUT],
		["bored", EM_BORED],
		["angry", EM_ANGRY],
		["coy", EM_COY],
	])("swaps the torso at full %s", (_name, emotion) => {
		expect(torsoPose(emotion, 1)).not.toBe(NEUTRAL_POSE);
	});

	it("gives each mapped emotion its own drawing", () => {
		const poses = [EM_LAUGH, EM_SHOUT, EM_BORED, EM_ANGRY, EM_COY].map(
			(emotion) => torsoPose(emotion, 1),
		);
		expect(new Set(poses).size).toBe(poses.length);
	});

	it("stands neutral at a low intensity and at the middle of the wheel", () => {
		expect(torsoPose(EM_LAUGH, 0.2)).toBe(NEUTRAL_POSE);
		expect(torsoPose(EM_NEUTRAL, 0)).toBe(NEUTRAL_POSE);
	});
});
