import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvatarData } from "../src/engine/avatar.js";
import { renderSheetSvg } from "../src/render/svgSheet.js";
import { CanvasTextMeasurer } from "../src/render/textMetrics.js";
import { TableMeasureContext } from "../src/render/textTable.js";
import { composeStrip } from "../src/studio/compose.js";
import { buildCatalog, parseStrip } from "../src/studio/script.js";

const fixture = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

// the fixtures carry no atlas mappings, so give every pose one
const avatars = fixture.avatars.map((avatar) => ({
	...avatar,
	poses: avatar.poses.map((pose, index) => ({
		...pose,
		sprite: { atlasUrl: `/assets/avatars/${avatar.name}.png`, x: index, y: 0 },
	})),
}));

const catalog = buildCatalog(avatars, ["volcano"]);
const resolveStyle = new CanvasTextMeasurer(
	new TableMeasureContext(),
).styleResolver();

const sheetAssets = {
	atlas: (url: string) => ({ href: url, width: 4096, height: 64 }),
	backdrop: (name: string) => ({ href: `bg:${name}`, width: 640, height: 480 }),
};

function render(source: unknown, columns = 4): string {
	const { strip, issues } = parseStrip(source, catalog);
	expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
	const composed = composeStrip(strip, { avatars, resolveStyle });
	return renderSheetSvg(composed, {
		avatars,
		columns,
		host: "comics.test",
		assets: sheetAssets,
		fontDefs: "<style>@font-face{font-family:'Comic Neue'}</style>",
	});
}

describe("renderSheetSvg", () => {
	it("lays two panels on one sheet with balloons, backdrop, and the credit", () => {
		const svg = render({
			version: 2,
			panels: [
				{
					background: "volcano",
					actors: [{ avatar: "anna", text: "Hello there" }],
				},
				{ actors: [{ avatar: "bolo", text: "Hi", mode: "whisper" }] },
			],
		});
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
			true,
		);
		// 2 columns of 600px cards with 31px gutters, one extra pixel for the credit band
		expect(svg).toContain('viewBox="0 0 1293 663"');
		expect(svg).toContain('href="bg:volcano"');
		expect(svg).toContain('href="/assets/avatars/anna.png"');
		expect(svg).toContain('href="/assets/avatars/bolo.png"');
		// the engine sets balloon text in caps and wraps it to the balloon width
		expect(svg).toContain(">HELLO</text>");
		expect(svg).toContain(">THERE</text>");
		expect(svg).toContain('font-style="italic"');
		expect(svg).toContain("Comic Chat 1996 port");
		expect(svg).toContain("created at comics.test");
		expect(svg).toContain("@font-face");
		// each panel clips itself, plus one clip per sprite draw
		expect(svg.match(/<clipPath /g)?.length).toBeGreaterThanOrEqual(4);
	});

	it("draws a title card with its stars and centred heading", () => {
		const svg = render({
			version: 2,
			panels: [
				{
					kind: "title",
					title: "The Test",
					footer: "a vitest production",
					actors: [{ avatar: "anna" }, { avatar: "bolo", text: "Bolo" }],
				},
				{ actors: [{ avatar: "anna", text: "Hi" }] },
			],
		});
		expect(svg).toContain(">The Test</text>");
		expect(svg).toContain(">STARRING</text>");
		expect(svg).toContain(">Anna</text>");
		expect(svg).toContain(">Bolo</text>");
		expect(svg).toContain(">a vitest production</text>");
	});

	it("wraps rows by the requested column count", () => {
		const panel = { actors: [{ avatar: "anna", text: "Hi" }] };
		const svg = render(
			{ version: 2, columns: 2, panels: [panel, panel, panel] },
			2,
		);
		// two columns wide, two rows tall
		expect(svg).toContain('viewBox="0 0 1293 1294"');
	});
});
