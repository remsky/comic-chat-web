import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";
import { avatarArtCache } from "../src/studio/art.js";
import { emotionAngles } from "../src/studio/script.js";
import { sameEmotion, suggester } from "../src/studio/suggest.js";

const { avatars } = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const suggest = suggester(avatars, avatarArtCache(avatars, emotionAngles()));

describe("the pose the rules reach for", () => {
	it("reads the line, so shouting draws a different face than saying nothing", () => {
		expect(suggest.art("bolo", "")).toEqual({ emotion: "neutral_1" });
		expect(suggest.art("bolo", "LOOK OUT!!!")).toEqual({ emotion: "shout_1" });
	});

	it("reaches for the gesture a greeting calls for", () => {
		expect(suggest.art("bolo", "hello there").gesture).toBe("wave");
	});

	// chat.rc's first-person rule, which is a torso and not a face
	it("points a character at themselves without touching their expression", () => {
		expect(suggest.art("bolo", "i am so sad")).toEqual({
			emotion: "neutral_1",
			gesture: "pointself",
		});
	});

	it("leaves the torso unnamed where the face already brings it", () => {
		expect(suggest.art("bolo", "hehe :)")).toEqual({ emotion: "happy_2" });
	});

	it("draws on whatever art the character actually owns", () => {
		// anna has no shout face, so the same line lands somewhere else on her wheel
		expect(suggest.art("anna", "LOOK OUT!!!").emotion).toBe("angry_2");
	});

	it("says nothing about a character it has never heard of", () => {
		expect(suggest.art("nobody", "hello there")).toEqual({});
	});
});

describe("the facings the rules reach for", () => {
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

describe("sameEmotion", () => {
	it("reads an absent emotion and the first neutral as the same resting face", () => {
		expect(sameEmotion(undefined, "neutral")).toBe(true);
		expect(sameEmotion(undefined, "neutral_1")).toBe(true);
		expect(sameEmotion("neutral_1", "neutral")).toBe(true);
	});

	it("treats a bare name and its _1 variant as the same face", () => {
		expect(sameEmotion("shout", "shout_1")).toBe(true);
		expect(sameEmotion("happy_1", "happy")).toBe(true);
	});

	it("tells a chosen face apart from the resting one", () => {
		expect(sameEmotion(undefined, "happy_2")).toBe(false);
		expect(sameEmotion("angry_2", "happy_2")).toBe(false);
		expect(sameEmotion("neutral_2", "neutral_1")).toBe(false);
	});
});
