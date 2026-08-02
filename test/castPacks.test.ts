import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAST_BOUNDS } from "../src/protocol/castBounds.js";
import {
	ART_PACKS,
	PACK_IDS,
	packOf,
	resolvePacks,
	shipsBackdrop,
	shipsCharacter,
	unknownPacks,
} from "../src/protocol/castPacks.js";
import {
	droppedAvatarAtlases,
	shippedManifests,
} from "../src/studio/catalogJson.js";

const read = (file: string): string =>
	readFileSync(resolve(process.cwd(), file), "utf8");

const AVATARS = read("public/assets/avatars/manifest.json");
const BACKDROPS = read("public/assets/backgrounds/manifest.json");

const cast = (avatarJson: string) =>
	(JSON.parse(avatarJson) as { avatars: { name: string; avatarID: number }[] })
		.avatars;

describe("art packs", () => {
	it("ships the original cast alone when the flag says nothing", () => {
		expect(resolvePacks(undefined)).toEqual(new Set());
		expect(resolvePacks("")).toEqual(new Set());
		expect(resolvePacks("  ")).toEqual(new Set());
	});

	it("takes a list, all, or none", () => {
		expect(resolvePacks("all")).toEqual(new Set(PACK_IDS));
		expect(resolvePacks("none")).toEqual(new Set());
		expect(resolvePacks("artpack1, v2.1b")).toEqual(
			new Set(["artpack1", "v2.1b"]),
		);
	});

	it("reports a pack it does not know", () => {
		expect(unknownPacks("artpak1")).toEqual(["artpak1"]);
		expect(unknownPacks("artpack1")).toEqual([]);
		expect(unknownPacks("all")).toEqual([]);
	});

	it("holds every character to one pack, or to the base art", () => {
		const claimed = ART_PACKS.flatMap((pack) => pack.characters);
		expect(new Set(claimed).size).toBe(claimed.length);
		expect(packOf("dan")).toBeUndefined();
		expect(packOf("kirby")?.id).toBe("v2.1b");
		expect(packOf("sage")?.id).toBe("artpack1");
	});

	it("keeps the base art whatever the flag says", () => {
		const none = resolvePacks("none");
		expect(shipsCharacter("dan", none)).toBe(true);
		expect(shipsBackdrop("room", none)).toBe(true);
		expect(shipsCharacter("kirby", none)).toBe(false);
		expect(shipsBackdrop("den", none)).toBe(false);
		expect(shipsBackdrop("den", resolvePacks("artpack1"))).toBe(true);
	});
});

describe("the manifests a build publishes", () => {
	it("drops a disabled pack from the cast, the order, and the pose count", () => {
		const shipped = shippedManifests(
			AVATARS,
			BACKDROPS,
			resolvePacks("artpack1"),
		);
		const manifest = JSON.parse(shipped.avatars) as {
			castOrder: string[];
			avatars: { name: string; poses: unknown[] }[];
			poseCount: number;
		};
		const names = manifest.avatars.map((entry) => entry.name);
		expect(names).not.toContain("kirby");
		expect(names).toContain("sage");
		expect(manifest.castOrder.sort()).toEqual([...names].sort());
		expect(manifest.poseCount).toBe(
			manifest.avatars.reduce((total, entry) => total + entry.poses.length, 0),
		);
		expect(manifest.poseCount).toBeLessThan(
			(JSON.parse(AVATARS) as { poseCount: number }).poseCount,
		);
	});

	it("drops a disabled character's atlas under whatever filename it carries", () => {
		const dropped = droppedAvatarAtlases(AVATARS, resolvePacks("artpack1"));
		expect(dropped).toContain("kirby.png");
		// peety's atlas is content-hashed, so a name-derived filename would have missed it
		expect(dropped.some((file) => file.startsWith("peety-"))).toBe(true);
		expect(dropped).not.toContain("dan.png");
		expect(dropped).not.toContain("sage.png");
		expect(droppedAvatarAtlases(AVATARS, resolvePacks("all"))).toEqual([]);
	});

	it("drops the backdrops that came with that pack", () => {
		const shipped = shippedManifests(AVATARS, BACKDROPS, resolvePacks("none"));
		const names = (
			JSON.parse(shipped.backgrounds) as { backdrops: { name: string }[] }
		).backdrops.map((entry) => entry.name);
		expect(names).not.toContain("den");
		expect(names).not.toContain("volcano");
		expect(names).not.toContain("buckroom");
		expect(names).toContain("room");
	});

	it("ships everything the committed art holds when every pack is on", () => {
		const shipped = shippedManifests(AVATARS, BACKDROPS, resolvePacks("all"));
		expect(cast(shipped.avatars).length).toBe(cast(AVATARS).length);
	});

	it("leaves every surviving character its own id", () => {
		const full = new Map(cast(AVATARS).map((e) => [e.name, e.avatarID]));
		for (const flag of [undefined, "none", "all"])
			for (const entry of cast(
				shippedManifests(AVATARS, BACKDROPS, resolvePacks(flag)).avatars,
			))
				expect(entry.avatarID).toBe(full.get(entry.name));
	});

	it("keeps the record table over the whole cast, not the shipped one", () => {
		for (const entry of cast(AVATARS))
			expect(CAST_BOUNDS[entry.avatarID]?.name).toBe(entry.name);
		expect(Object.keys(CAST_BOUNDS).length).toBe(cast(AVATARS).length);
	});
});
