import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";
import {
	buildCatalog,
	COLUMNS_DEFAULT,
	COLUMNS_MAX,
	COLUMNS_MIN,
	emotionVector,
	MAX_ACTORS,
	parseStrip,
	parseStripJson,
	STRIP_VERSION,
	stripToJson,
} from "../src/studio/script.js";

const { avatars } = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const catalog = buildCatalog(avatars, ["volcano", "pastoral"]);

function errors(issues: { severity: string; path: string }[]): string[] {
	return issues
		.filter((issue) => issue.severity === "error")
		.map((i) => i.path);
}

describe("catalog", () => {
	it("names every torso, and offers a gesture command only where there is art", () => {
		const anna = catalog.avatars.find((entry) => entry.name === "anna");
		expect(anna?.gestures).toContain("wave");
		const connor = catalog.avatars.find((entry) => entry.name === "connor");
		expect(connor?.gestures).not.toContain("wave");
		expect(connor?.gestures).toContain("neutral_1");
	});

	it("offers every wheel emotion plus neutral", () => {
		expect(catalog.emotions).toContain("happy");
		expect(catalog.emotions).toContain("neutral");
		expect(catalog.emotions).toHaveLength(9);
	});
});

describe("emotionVector", () => {
	it("maps neutral to the centre detente", () => {
		expect(emotionVector("neutral", 1)).toEqual({ emotion: 0, intensity: 0 });
	});

	it("defaults a named emotion to full intensity", () => {
		expect(emotionVector("angry", undefined)?.intensity).toBe(1);
	});

	it("rejects an unknown name", () => {
		expect(emotionVector("smug", 1)).toBeNull();
	});
});

describe("parseStrip", () => {
	it("accepts a minimal panel", () => {
		const result = parseStrip(
			{ version: 2, panels: [{ actors: [{ avatar: "anna", text: "hi" }] }] },
			catalog,
		);
		expect(result.issues).toEqual([]);
		expect(result.strip.panels[0]?.actors[0]?.avatar).toBe("anna");
	});

	it("flags unknown avatars, emotions, gestures, modes, and backgrounds", () => {
		const result = parseStrip(
			{
				version: 2,
				panels: [
					{ background: "moon", actors: [{ avatar: "nobody" }] },
					{
						actors: [
							{ avatar: "anna", emotion: "smug" },
							{ avatar: "anna", gesture: "moonwalk" },
							{ avatar: "anna", mode: "yell" },
						],
					},
				],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([
			"panels[0].background",
			"panels[0].actors[0].avatar",
			"panels[1].actors[0].emotion",
			"panels[1].actors[1].gesture",
			"panels[1].actors[2].mode",
		]);
	});

	it("warns when an avatar lacks art for a legal gesture", () => {
		const result = parseStrip(
			{
				version: 2,
				panels: [{ actors: [{ avatar: "connor", gesture: "wave" }] }],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([]);
		expect(result.issues[0]?.severity).toBe("warning");
	});

	it("warns when an avatar lacks art for a legal emotion", () => {
		const result = parseStrip(
			{
				version: 2,
				panels: [{ actors: [{ avatar: "bolo", emotion: "bored" }] }],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([]);
		expect(result.issues[0]?.severity).toBe("warning");
	});

	it("takes a face name inside the character's range and rejects one outside it", () => {
		const read = (emotion: unknown): string[] =>
			errors(
				parseStrip(
					{ version: 2, panels: [{ actors: [{ avatar: "susan", emotion }] }] },
					catalog,
				).issues,
			);
		// susan draws five distinct happy faces, and five more at the wheel's centre
		expect(read("happy_1")).toEqual([]);
		expect(read("happy_5")).toEqual([]);
		expect(read("neutral_5")).toEqual([]);
		expect(read("happy_6")).toEqual(["panels[0].actors[0].emotion"]);
		expect(read("happy_0")).toEqual(["panels[0].actors[0].emotion"]);
		expect(read("smug_1")).toEqual(["panels[0].actors[0].emotion"]);
	});

	it("names a torso the wheel never picks, and rejects one the character lacks", () => {
		const read = (gesture: unknown) =>
			parseStrip(
				{ version: 2, panels: [{ actors: [{ avatar: "susan", gesture }] }] },
				catalog,
			).issues;
		expect(read("neutral_4")).toEqual([]);
		expect(errors(read("neutral_9"))).toEqual([]);
		expect(read("neutral_9")[0]?.severity).toBe("warning");
		expect(errors(read("moonwalk"))).toEqual(["panels[0].actors[0].gesture"]);
	});

	it("reads a retired intensity as the drawing it used to land on", () => {
		const susan = (extra: Record<string, string>) => ({
			avatar: "susan",
			...extra,
		});
		const read = (emotion: string, intensity: number): unknown => {
			const result = parseStrip(
				{
					version: 1,
					panels: [{ actors: [{ avatar: "susan", emotion, intensity }] }],
				},
				catalog,
			);
			expect(errors(result.issues)).toEqual([]);
			expect(result.issues[0]?.path).toBe("panels[0].actors[0].intensity");
			return result.strip.panels[0]?.actors[0];
		};
		expect(read("happy", 0.1)).toEqual(susan({ emotion: "happy_1" }));
		expect(read("happy", 1)).toEqual(susan({ emotion: "happy_5" }));
		// the wheel drew nothing at no intensity, so neither does the name it converts to
		expect(read("happy", 0)).toEqual(susan({ emotion: "neutral" }));
		// susan wears one scared face over two torsos, which a face name alone cannot say
		expect(read("scared", 0.1)).toEqual(
			susan({ emotion: "scared_1", gesture: "neutral_1" }),
		);
		expect(read("scared", 0.9)).toEqual(susan({ emotion: "scared_1" }));
	});

	it("lets a retired strip's own gesture outrank the torso its intensity implied", () => {
		const result = parseStrip(
			{
				version: 1,
				panels: [
					{
						actors: [
							{
								avatar: "susan",
								emotion: "scared",
								intensity: 0.1,
								gesture: "wave",
							},
						],
					},
				],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([]);
		expect(result.strip.panels[0]?.actors[0]?.gesture).toBe("wave");
	});

	it("reads the version it succeeded quietly, and flags one it has never seen", () => {
		const versionIssues = (version: unknown): string[] =>
			parseStrip({ version, panels: [] }, catalog).issues.map(
				(issue) => issue.path,
			);
		expect(versionIssues(1)).toEqual([]);
		expect(versionIssues(STRIP_VERSION)).toEqual([]);
		expect(versionIssues(3)).toEqual(["version"]);
		expect(versionIssues("2")).toEqual(["version"]);
	});

	it("caps the cast at the engine limit", () => {
		const actors = Array.from({ length: MAX_ACTORS + 2 }, () => ({
			avatar: "anna",
		}));
		const result = parseStrip({ version: 2, panels: [{ actors }] }, catalog);
		expect(errors(result.issues)).toEqual(["panels[0].actors"]);
		expect(result.strip.panels[0]?.actors).toHaveLength(MAX_ACTORS);
	});

	it("rejects out of range intensity and zoom", () => {
		const result = parseStrip(
			{
				version: 2,
				panels: [{ zoom: 9, actors: [{ avatar: "anna", intensity: 4 }] }],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([
			"panels[0].zoom",
			"panels[0].actors[0].intensity",
		]);
	});

	it("takes a column count inside the range and rejects one outside it", () => {
		const read = (columns: unknown): number | undefined =>
			parseStrip({ version: 2, columns, panels: [] }, catalog).strip.columns;
		expect(read(COLUMNS_MIN)).toBe(COLUMNS_MIN);
		expect(read(COLUMNS_MAX)).toBe(COLUMNS_MAX);
		expect(read(0)).toBeUndefined();
		expect(read(COLUMNS_MAX + 1)).toBeUndefined();
		expect(read(2.5)).toBeUndefined();
		expect(
			errors(
				parseStrip({ version: 2, columns: 0, panels: [] }, catalog).issues,
			),
		).toEqual(["columns"]);
	});

	it("reports malformed JSON without throwing", () => {
		const result = parseStripJson("{ nope", catalog);
		expect(result.issues[0]?.severity).toBe("error");
		expect(result.strip.panels).toEqual([]);
	});
});

describe("stripToJson", () => {
	it("round-trips through the parser without acquiring defaults", () => {
		const source = {
			version: 2,
			panels: [
				{
					background: "volcano",
					camera: "close",
					actors: [
						{ avatar: "anna", text: "hi", emotion: "happy", facing: "left" },
						{ avatar: "bolo", gesture: "wave" },
					],
				},
			],
		};
		const once = stripToJson(parseStrip(source, catalog).strip);
		const twice = stripToJson(parseStripJson(once, catalog).strip);
		expect(twice).toBe(once);
		expect(JSON.parse(once)).toEqual(source);
	});

	it("keeps a face name through the round trip", () => {
		const source = {
			version: 2,
			panels: [
				{ actors: [{ avatar: "susan", emotion: "happy_2" }] },
				{ actors: [{ avatar: "susan", emotion: "happy" }] },
				{ actors: [{ avatar: "susan", gesture: "neutral_3" }] },
			],
		};
		const once = stripToJson(parseStrip(source, catalog).strip);
		expect(JSON.parse(once)).toEqual(source);
		expect(stripToJson(parseStripJson(once, catalog).strip)).toBe(once);
	});

	it("writes a column count only when it differs from the default", () => {
		const write = (columns: number): unknown =>
			JSON.parse(stripToJson({ version: 2, columns, panels: [] }));
		expect(write(COLUMNS_DEFAULT)).toEqual({ version: 2, panels: [] });
		expect(write(2)).toEqual({ version: 2, columns: 2, panels: [] });
	});
});
