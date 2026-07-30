import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ART_PACKS, resolvePacks } from "../src/protocol/castPacks.js";
import {
	catalogFromManifests,
	shippedManifests,
} from "../src/studio/catalogJson.js";

const read = (file: string): string =>
	readFileSync(resolve(process.cwd(), file), "utf8");

const SKILL = "plugins/comic-strip/skills/comic-strip";

const query = (...args: string[]): string =>
	execFileSync(
		process.execPath,
		[resolve(process.cwd(), `${SKILL}/scripts/cast-query.mjs`), ...args],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);

describe("the strip skill's vendored reference", () => {
	// the vendored reference tracks this repo's own deploy, which enables artpack1
	const shipped = shippedManifests(
		read("public/assets/avatars/manifest.json"),
		read("public/assets/backgrounds/manifest.json"),
		resolvePacks("artpack1"),
	);
	const published = catalogFromManifests(shipped.avatars, shipped.backgrounds);

	it("carries the catalog the build publishes", () => {
		expect(JSON.parse(read(`${SKILL}/reference/catalog.json`))).toEqual(
			published,
		);
	});

	const rowsOf = (file: string): Set<string> =>
		new Set(
			[...read(`${SKILL}/reference/${file}`).matchAll(/^\| ([a-z]+) \|/gm)].map(
				(match) => match[1] as string,
			),
		);

	it("describes every character the catalog names", () => {
		const rows = rowsOf("cast.md");
		expect(
			published.avatars.map((entry) => entry.name).filter((n) => !rows.has(n)),
		).toEqual([]);
	});

	it("names nobody the vendored packs leave out", () => {
		const packs = resolvePacks("artpack1");
		const dropped = ART_PACKS.filter((pack) => !packs.has(pack.id)).flatMap(
			(pack) => pack.characters,
		);
		expect(dropped.length).toBeGreaterThan(0);
		const rows = rowsOf("cast.md");
		const prose = `${read(`${SKILL}/reference/cast.md`)}${read(`${SKILL}/reference/guidance.md`)}`;
		for (const name of dropped) {
			expect(rows.has(name)).toBe(false);
			expect(prose).not.toContain(`\`${name}\``);
		}
	});

	it("describes every backdrop the catalog names", () => {
		const rows = rowsOf("backgrounds.md");
		expect(published.backgrounds.filter((name) => !rows.has(name))).toEqual([]);
	});

	// cast-query reads cast.md's prose, so a rewrite that breaks the parse has to fail here
	it("can cast every character by register", () => {
		let usage = "";
		try {
			query();
		} catch (error) {
			usage = String((error as { stderr?: string }).stderr ?? "");
		}
		const groups = (/one of: (.+)/.exec(usage)?.[1] ?? "").split(", ");
		expect(groups.length).toBeGreaterThan(3);

		const cast = new Set(
			groups.flatMap((group) =>
				[...query("--register", group).matchAll(/^ {2}([a-z]+) /gm)].map(
					(match) => match[1] as string,
				),
			),
		);
		expect(
			published.avatars
				.map((entry) => entry.name)
				.filter((name) => !cast.has(name)),
		).toEqual([]);
	});

	it("reports the faces and poses a character owns", () => {
		const dumped = query("dan");
		expect(dumped).toContain("office everyman");
		expect(dumped).toMatch(/^ {2}faces {4}happy \d/m);
		expect(dumped).toContain("shrug");
		expect(dumped).toContain("angry 2 (=sad)");
	});

	it("narrows the troupe by pose and register together", () => {
		const shrugs = query("--gesture", "shrug", "--register", "office");
		expect(shrugs).toContain("dan");
		expect(shrugs).not.toContain("connor");
	});

	// this reads the range prose, so a reworded table would silently match nobody
	it("splits the troupe on whether it can react", () => {
		const reacts = query("--reacts");
		expect(reacts).toContain("dan");
		expect(reacts).not.toContain("pedagog");
	});
});
