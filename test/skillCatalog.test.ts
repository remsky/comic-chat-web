import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFromManifests } from "../src/studio/catalogJson.js";

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
	const published = catalogFromManifests(
		read("public/assets/avatars/manifest.json"),
		read("public/assets/backgrounds/manifest.json"),
	);

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

	// these two read the look and range prose, so a reworded table would silently match nobody
	it("splits the troupe on colour and on whether it can react", () => {
		const colour = query("--colour");
		const mono = query("--mono");
		const colourNames = [...colour.matchAll(/^ {2}([a-z]+) /gm)].map(
			(match) => match[1] as string,
		);
		expect(colourNames.sort()).toEqual(["buck", "kirby", "veronica"]);
		expect(mono).toContain("dan");
		expect(mono).not.toContain("buck");

		const speaks = query("--speaks");
		expect(speaks).toContain("dan");
		expect(speaks).not.toContain("pedagog");
	});
});
