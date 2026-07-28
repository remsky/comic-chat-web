import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";
import { AvatarRegistry } from "../src/engine/avatar.js";
import { avatarArtCache, type AvatarArt } from "../src/studio/art.js";
import { bodyForActor } from "../src/studio/compose.js";
import { emotionAngles } from "../src/studio/script.js";
import { suggester } from "../src/studio/suggest.js";

const { avatars } = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const artFor = avatarArtCache(avatars, emotionAngles());
const suggest = suggester(avatars, artFor);
const registry = new AvatarRegistry(avatars);

function findAvatar(name: string) {
	return registry.avatars.find((entry) => entry.data.name === name)!;
}

function bodyIndices(name: string, text?: string, emotion?: string, gesture?: string) {
	const avatar = findAvatar(name);
	const art = artFor(name);
	const body = bodyForActor(avatar, { avatar: name, text, emotion, gesture }, art);
	return body.kind === "simple"
		? { body: body.bodyIndex }
		: { face: body.faceIndex, torso: body.torsoIndex };
}

describe("compose reads the text when emotion is absent", () => {
	it("picks a different face for shouting than for silence", () => {
		const silent = bodyIndices("bolo");
		const shouting = bodyIndices("bolo", "LOOK OUT!!!");
		expect(shouting).not.toEqual(silent);
	});

	it("uses the named emotion when one is set, ignoring the text", () => {
		const explicit = bodyIndices("bolo", "LOOK OUT!!!", "happy");
		const manual = bodyIndices("bolo", undefined, "happy");
		expect(explicit).toEqual(manual);
	});

	it("falls back to neutral for a character with no text and no emotion", () => {
		const neutral = bodyIndices("bolo", undefined, "neutral");
		const absent = bodyIndices("bolo");
		expect(absent).toEqual(neutral);
	});

	it("applies an explicit gesture on top of the text-derived face", () => {
		const withGesture = bodyIndices("bolo", "LOOK OUT!!!", undefined, "wave");
		const withoutGesture = bodyIndices("bolo", "LOOK OUT!!!");
		expect(withGesture.face).toBe(withoutGesture.face);
		expect(withGesture.torso).not.toBe(withoutGesture.torso);
	});
});

describe("facings", () => {
	it("leaves a lone character facing right", () => {
		expect(suggest.facings({ actors: [{ avatar: "anna" }] })).toEqual(["right"]);
	});

	it("turns a pair towards each other", () => {
		expect(
			suggest.facings({ actors: [{ avatar: "anna" }, { avatar: "bolo" }] }),
		).toEqual(["right", "left"]);
	});

	it("skips a character it cannot cast instead of shifting the rest", () => {
		expect(
			suggest.facings({
				actors: [{ avatar: "anna" }, { avatar: "nobody" }, { avatar: "bolo" }],
			}),
		).toEqual(["right", "left"]);
	});
});
