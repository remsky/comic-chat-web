import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type AvatarData, createAvatar } from "../src/engine/avatar.js";
import { avatarArtCache, splitArtName } from "../src/studio/art.js";
import { emotionAngles } from "../src/studio/script.js";

const { avatars } = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const artOf = avatarArtCache(avatars, emotionAngles());

function dataOf(name: string): AvatarData {
	const data = avatars.find((entry) => entry.name === name);
	if (!data) throw new Error(`no fixture for ${name}`);
	return data;
}

// the drawing a name resolves to, which is what "distinct art" has to mean
function facePose(name: string, key: string): number {
	const data = dataOf(name);
	const body = artOf(name).faces[key];
	if (!body) throw new Error(`${name} has no face "${key}"`);
	return (data.type === "complex" ? data.faces : data.bodies)[body.face]
		?.poseID as number;
}

describe("splitArtName", () => {
	it("separates the index from the emotion, and leaves a bare name alone", () => {
		expect(splitArtName("happy_2")).toEqual({ base: "happy", index: 2 });
		expect(splitArtName("happy")).toEqual({ base: "happy" });
		expect(splitArtName("point_at_me")).toEqual({ base: "point_at_me" });
	});
});

describe("avatarArtCache", () => {
	it("names one face per drawing, and reads a bare name as the strongest", () => {
		const susan = artOf("susan");
		expect(susan.counts.happy).toBe(5);
		const poses = [1, 2, 3, 4, 5].map((n) => facePose("susan", `happy_${n}`));
		expect(new Set(poses).size).toBe(5);
		expect(facePose("susan", "happy")).toBe(poses[4]);
	});

	it("counts a torso-only change as the same face", () => {
		// susan draws one scared face; the torso swapping under it is not another degree
		expect(artOf("susan").counts.scared).toBe(1);
	});

	it("gathers the drawings the wheel ties out of reach under neutral", () => {
		const susan = artOf("susan");
		expect(susan.counts.neutral).toBe(5);
		const poses = [1, 2, 3, 4, 5].map((n) => facePose("susan", `neutral_${n}`));
		expect(new Set(poses).size).toBe(5);
		// bare neutral is the one the wheel settles on, which is the first
		expect(facePose("susan", "neutral")).toBe(poses[0]);
	});

	// the whole shipped cast, not the fixture subset: art nobody can name is art nobody can use
	it("leaves no drawing on any sheet unnamed", () => {
		const shipped = JSON.parse(
			readFileSync(
				resolve(process.cwd(), "public/assets/avatars/manifest.json"),
				"utf8",
			),
		) as { avatars: AvatarData[] };
		const shippedArt = avatarArtCache(shipped.avatars, emotionAngles());
		for (const data of shipped.avatars) {
			const art = shippedArt(data.name);
			const faces = data.type === "complex" ? data.faces : data.bodies;
			const named = new Set(
				Object.values(art.faces).map((body) => faces[body.face]?.poseID),
			);
			expect(named).toEqual(new Set(faces.map((record) => record.poseID)));
			const torsos = data.type === "complex" ? data.torsos : data.bodies;
			expect(new Set(Object.values(art.torsos)).size).toBe(torsos.length);
		}
	});

	it("keeps a simple avatar's face and torso the same record", () => {
		const connor = artOf("connor");
		expect(connor.counts.neutral).toBeGreaterThan(1);
		for (const body of Object.values(connor.faces))
			expect(body.torso).toBe(body.face);
	});

	it("names every torso, gestures included", () => {
		const susan = artOf("susan");
		expect(susan.torsos.wave).toBeTypeOf("number");
		const data = dataOf("susan");
		const named = new Set(Object.values(susan.torsos));
		expect(named.size).toBe(data.torsos.length);
	});

	it("names the emotion a character draws with another emotion's faces", () => {
		const susan = artOf("susan");
		expect(susan.aliases.bored).toBe("coy");
		expect(susan.aliases.coy).toBeUndefined();
		expect(facePose("susan", "bored_1")).toBe(facePose("susan", "coy_1"));
	});

	it("lands each named face on one the wheel actually reaches", () => {
		const data = dataOf("susan");
		const avatar = createAvatar(data);
		const angle = new Map(emotionAngles()).get("angry") as number;
		const reached = new Set<number>();
		for (let step = 0; step <= 20; step++) {
			const body = avatar.getBodyFromEmotion(angle, step / 20);
			if (body.kind !== "complex") continue;
			reached.add(data.faces[body.faceIndex]?.poseID as number);
		}
		for (let n = 1; n <= (artOf("susan").counts.angry ?? 0); n++)
			expect(reached).toContain(facePose("susan", `angry_${n}`));
	});

	it("returns nothing for a character it has never heard of", () => {
		expect(artOf("nobody").counts).toEqual({});
		expect(artOf("nobody").faces).toEqual({});
	});
});
