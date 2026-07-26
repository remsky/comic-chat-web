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
	it("lists only the gestures an avatar has art for", () => {
		const anna = catalog.avatars.find((entry) => entry.name === "anna");
		expect(anna?.gestures).toContain("wave");
		const connor = catalog.avatars.find((entry) => entry.name === "connor");
		expect(connor?.gestures).toEqual([]);
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
			{ version: 1, panels: [{ actors: [{ avatar: "anna", text: "hi" }] }] },
			catalog,
		);
		expect(result.issues).toEqual([]);
		expect(result.strip.panels[0]?.actors[0]?.avatar).toBe("anna");
	});

	it("flags unknown avatars, emotions, gestures, modes, and backgrounds", () => {
		const result = parseStrip(
			{
				version: 1,
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
				version: 1,
				panels: [{ actors: [{ avatar: "connor", gesture: "wave" }] }],
			},
			catalog,
		);
		expect(errors(result.issues)).toEqual([]);
		expect(result.issues[0]?.severity).toBe("warning");
	});

	it("caps the cast at the engine limit", () => {
		const actors = Array.from({ length: MAX_ACTORS + 2 }, () => ({
			avatar: "anna",
		}));
		const result = parseStrip({ version: 1, panels: [{ actors }] }, catalog);
		expect(errors(result.issues)).toEqual(["panels[0].actors"]);
		expect(result.strip.panels[0]?.actors).toHaveLength(MAX_ACTORS);
	});

	it("rejects out of range intensity and zoom", () => {
		const result = parseStrip(
			{
				version: 1,
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
			parseStrip({ version: 1, columns, panels: [] }, catalog).strip.columns;
		expect(read(COLUMNS_MIN)).toBe(COLUMNS_MIN);
		expect(read(COLUMNS_MAX)).toBe(COLUMNS_MAX);
		expect(read(0)).toBeUndefined();
		expect(read(COLUMNS_MAX + 1)).toBeUndefined();
		expect(read(2.5)).toBeUndefined();
		expect(
			errors(
				parseStrip({ version: 1, columns: 0, panels: [] }, catalog).issues,
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
			version: 1,
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

	it("writes a column count only when it differs from the default", () => {
		const write = (columns: number): unknown =>
			JSON.parse(stripToJson({ version: 1, columns, panels: [] }));
		expect(write(COLUMNS_DEFAULT)).toEqual({ version: 1, panels: [] });
		expect(write(2)).toEqual({ version: 1, columns: 2, panels: [] });
	});
});
