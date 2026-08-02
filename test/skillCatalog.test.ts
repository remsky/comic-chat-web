import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ART_PACKS,
	resolvePacks,
	VENDORED_PACKS,
} from "../src/protocol/castPacks.js";
import {
	catalogFromManifests,
	SKILL_DOCS,
	SKILL_REFERENCE,
	shippedManifests,
} from "../src/studio/catalogJson.js";
import { EMITTED, emitModule } from "../tools/generateValidator.js";

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
	// scripts/generate-skill-catalog.mjs emits the vendored copy from this same pack set
	const shipped = shippedManifests(
		read("public/assets/avatars/manifest.json"),
		read("public/assets/backgrounds/manifest.json"),
		resolvePacks(VENDORED_PACKS),
	);
	const published = catalogFromManifests(
		shipped.avatars,
		shipped.backgrounds,
		read(`${SKILL}/reference/cast.md`),
	);

	it("carries the catalog the build publishes", () => {
		expect(JSON.parse(read(`${SKILL}/reference/catalog.json`))).toEqual(
			published,
		);
	});

	// the skill's modules are emitted from the worker's, so editing one and not regenerating fails here
	it.each(EMITTED)("ships the $target the worker authors", async (emit) => {
		expect(read(emit.target)).toBe(
			await emitModule(read(emit.source), emit.source),
		);
	});

	// the build republishes these exact files under assets/, which the MCP tools serve
	it.each(SKILL_DOCS)("publishes %s to the worker", (doc) => {
		expect(resolve(process.cwd(), `${SKILL_REFERENCE}/${doc}`)).toBe(
			resolve(process.cwd(), `${SKILL}/reference/${doc}`),
		);
		expect(read(`${SKILL_REFERENCE}/${doc}`).length).toBeGreaterThan(0);
	});

	it("keeps the craft doc readable with no sibling files to open", () => {
		const guidance = read(`${SKILL_REFERENCE}/guidance.md`);
		expect(guidance).toContain("## Staging, which is where strips go wrong");
		expect(guidance).not.toMatch(/cast-query\.mjs|cast\.md|backgrounds\.md/);
	});

	// a row that breaks mid-cell renders as a mangled table and no other test reads past the name
	it("keeps every reference table well formed", () => {
		for (const file of [
			"SKILL.md",
			"reference/cast.md",
			"reference/backgrounds.md",
		]) {
			let width = 0;
			read(`${SKILL}/${file}`)
				.split("\n")
				.forEach((line, index) => {
					if (!line.startsWith("|")) {
						width = 0;
						return;
					}
					const row = line.trimEnd();
					const at = `${file}:${index + 1}`;
					expect(row.endsWith("|"), `${at} is cut off mid-cell`).toBe(true);
					const cells = row.slice(1, -1).split("|").length;
					if (width === 0) width = cells;
					expect(cells, `${at} has ${cells} cells, table has ${width}`).toBe(
						width,
					);
				});
		}
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
		// the parse bakes the table into the catalog, so a reworded row surfaces as a look-less avatar
		expect(
			published.avatars.filter((entry) => !entry.look).map((e) => e.name),
		).toEqual([]);
	});

	it("names nobody the vendored packs leave out", () => {
		const packs = resolvePacks(VENDORED_PACKS);
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

	// the registers ride in catalog.json, parsed from cast.md at generate time; a rewrite that breaks the parse has to fail here
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
