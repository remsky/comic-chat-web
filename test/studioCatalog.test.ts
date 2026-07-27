import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";
import {
	catalogFromManifests,
	catalogJson,
} from "../src/studio/catalogJson.js";
import { buildCatalog } from "../src/studio/script.js";

const avatarJson = readFileSync(
	resolve(process.cwd(), "test/fixtures/avatars.json"),
	"utf8",
);
const { avatars } = JSON.parse(avatarJson) as { avatars: AvatarData[] };
const backgroundJson = JSON.stringify({
	backdrops: [{ name: "volcano" }, { name: "pastoral" }],
});

describe("catalogJson", () => {
	const published = catalogJson(buildCatalog(avatars, ["volcano"]), "test");
	const find = (name: string) =>
		published.avatars.find((entry) => entry.name === name);

	it("counts the faces behind each name instead of the intensities under them", () => {
		expect(find("susan")?.emotions.happy).toBe(5);
		// the four drawings the wheel ties out of reach answer to neutral_2 and up
		expect(find("susan")?.emotions.neutral).toBe(5);
		expect(JSON.stringify(published)).not.toContain("0.9");
	});

	it("publishes every torso, named, including the ones the wheel never picks", () => {
		const gestures = find("susan")?.gestures ?? [];
		expect(gestures).toContain("wave");
		expect(gestures).toContain("neutral_4");
		expect(gestures.filter((name) => name.startsWith("neutral_"))).toHaveLength(
			5,
		);
		// pose ids stay inside the studio; a script only ever names art
		expect(JSON.stringify(published)).not.toContain("116");
	});

	it("lists the commands first, then the stances grouped in emotion order", () => {
		expect(find("susan")?.gestures).toEqual([
			"wave",
			"point",
			"pointself",
			"shrug",
			"neutral_1",
			"neutral_2",
			"neutral_3",
			"neutral_4",
			"neutral_5",
			"scared_1",
			"angry_1",
		]);
	});

	it("names an emotion a character only draws with another emotion's faces", () => {
		expect(find("susan")?.aliases).toEqual({ bored: "coy" });
		expect(find("anna")?.aliases).toBeUndefined();
	});

	it("leaves the gesture commands out for a character that cannot strike one", () => {
		const connor = find("connor")?.gestures ?? [];
		expect(connor).not.toContain("wave");
		// a simple avatar draws one sprite, so its emotions are its torsos
		expect(connor).toContain("neutral_1");
		expect(find("anna")?.gestures).toContain("wave");
	});

	it("carries the limits a script is validated against", () => {
		expect(published.limits.actors).toBe(5);
		expect(published.limits.columns).toEqual([1, 8]);
	});
});

describe("catalogFromManifests", () => {
	it("reads the committed manifests and stamps the art they describe", () => {
		const built = catalogFromManifests(avatarJson, backgroundJson);
		expect(built.backgrounds).toEqual(["volcano", "pastoral"]);
		expect(built.avatars).toHaveLength(avatars.length);
		expect(built.art).toMatch(/^[0-9a-f]{8}$/);
	});

	it("moves the stamp when the art moves, so a stale copy is visible", () => {
		const first = catalogFromManifests(avatarJson, backgroundJson).art;
		expect(catalogFromManifests(avatarJson, backgroundJson).art).toBe(first);
		expect(catalogFromManifests(` ${avatarJson}`, backgroundJson).art).not.toBe(
			first,
		);
	});
});
