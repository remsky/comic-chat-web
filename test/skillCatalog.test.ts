import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFromManifests } from "../src/studio/catalogJson.js";

const read = (file: string): string =>
	readFileSync(resolve(process.cwd(), file), "utf8");

const SKILL = "plugins/comic-strip/skills/comic-strip";

describe("the strip skill's vendored reference", () => {
	const published = catalogFromManifests(
		read("public/assets/avatars/manifest.json"),
		read("public/assets/backgrounds/manifest.json"),
	);

	it("carries the catalog the build publishes", () => {
		expect(JSON.parse(read(`${SKILL}/reference/catalog.json`))).toEqual(
			published,
		);
	});

	it("describes every character and backdrop that catalog names", () => {
		const rows = new Set(
			[...read(`${SKILL}/reference/cast.md`).matchAll(/^\| ([a-z]+) \|/gm)].map(
				(match) => match[1],
			),
		);
		const named = [
			...published.avatars.map((entry) => entry.name),
			...published.backgrounds,
		];
		expect(named.filter((name) => !rows.has(name))).toEqual([]);
	});
});
