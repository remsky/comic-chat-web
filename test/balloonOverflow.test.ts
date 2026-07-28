import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { PanelPage } from "../src/engine/panel.js";
import {
	BalloonRuntime,
	type BalloonStyle,
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../src/engine/panelBalloon.js";
import { MsvcRand } from "../src/engine/rand.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

const UNIT = 3000;
const CHAR_WIDTH = 200;

const style: BalloonStyle = {
	measure: (text) => ({ cx: text.length * CHAR_WIDTH, cy: 397 }),
	font: { lineHeight: 327, baseAdd: 60, leading: -70 },
};

function makePage(): PanelPage {
	const registry = new AvatarRegistry(fixture.avatars);
	const options = {
		unitWidth: UNIT,
		unitHeight: UNIT,
		resolveStyle: () => style,
	};
	return new PanelPage({
		registry,
		rand: new MsvcRand(1515),
		unitWidth: UNIT,
		unitHeight: UNIT,
		hooks: {
			makeBalloon: (text, mode, speaker) =>
				makeRuntimeBalloon(text, mode, speaker, options.resolveStyle),
			layoutBalloons: (panel, rand) =>
				layoutPanelBalloons(panel, rand, options),
		},
	});
}

function balloonsOf(page: PanelPage) {
	return page.panels.flatMap((panel) => panel?.balloons ?? []);
}

describe("balloon overflow", () => {
	it("splits a message too long to format into panels", () => {
		const page = makePage();
		const words = Array.from({ length: 200 }, (_, index) => `word${index}`);
		page.addLine(1, words.join(" "), 1);
		expect(page.panels.length).toBeGreaterThan(2);
		for (const balloon of balloonsOf(page)) {
			const runtime = balloon.runtime;
			expect(runtime).toBeInstanceOf(BalloonRuntime);
			expect((runtime as BalloonRuntime).fInfo).toBeTruthy();
		}
	});

	it("keeps the whole message across the split panels", () => {
		const page = makePage();
		const words = Array.from({ length: 200 }, (_, index) => `WORD${index}`);
		page.addLine(1, words.join(" "), 1);
		const shown = balloonsOf(page)
			.map((balloon) => balloon.text)
			.join(" ")
			.replaceAll("...", " ");
		for (const word of words) expect(shown).toContain(word);
	});

	it("splits a long line with no spaces to break on", () => {
		const page = makePage();
		page.addLine(1, "X".repeat(1000), 1);
		expect(page.panels.length).toBeGreaterThan(1);
	});
});
