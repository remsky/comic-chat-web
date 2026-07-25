import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	NORMAL_FONT_METRICS,
	WHISPER_FONT_METRICS,
} from "../src/browser/canvasText.js";
import { CLASSIC_UNIT, MODERN_UNIT } from "../src/browser/panelUnits.js";
import type { AvatarData } from "../src/engine/avatar.js";
import { EM_WAVE } from "../src/engine/emotion.js";
import { SM_WHISPER } from "../src/engine/panel.js";
import type { BalloonStyleResolver } from "../src/engine/panelBalloon.js";
import { composeStrip } from "../src/studio/compose.js";
import { buildCatalog, parseStrip, type Strip } from "../src/studio/script.js";

const { avatars } = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const catalog = buildCatalog(avatars, ["volcano"]);

// fixed-advance stand-in for the canvas measurer; balloon geometry only needs a monotonic width
const measure = (height: number) => (text: string) => ({
	cx: text.length * 150,
	cy: height,
});
const resolveStyle: BalloonStyleResolver = (_text, mode) =>
	mode === SM_WHISPER
		? {
				measure: measure(384),
				widestMeasure: measure(212),
				font: WHISPER_FONT_METRICS,
			}
		: {
				measure: measure(397),
				widestMeasure: measure(212),
				font: NORMAL_FONT_METRICS,
			};

function compose(source: unknown) {
	const { strip, issues } = parseStrip(source, catalog);
	expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
	return composeStrip(strip, { avatars, resolveStyle });
}

function anna(extra: Record<string, unknown> = {}) {
	return { avatar: "anna", ...extra };
}

describe("composeStrip", () => {
	it("emits one panel per spec entry, in order, with the given cast", () => {
		const result = compose({
			version: 1,
			panels: [
				{ actors: [anna({ text: "one" })] },
				{ actors: [anna(), { avatar: "bolo", text: "two" }] },
			],
		});
		expect(result.panels).toHaveLength(2);
		expect(result.panels[0]?.panel.bodies).toHaveLength(1);
		expect(result.panels[1]?.panel.bodies.map((body) => body.avatarID)).toEqual(
			[1, 2],
		);
	});

	it("keeps a bodiless panel when no actor speaks", () => {
		const result = compose({ version: 1, panels: [{ actors: [anna()] }] });
		expect(result.panels[0]?.panel.balloons).toHaveLength(0);
		expect(result.panels[0]?.panel.bodies).toHaveLength(1);
	});

	it("applies facing directly instead of inferring it", () => {
		const result = compose({
			version: 1,
			panels: [
				{ actors: [anna({ facing: "left" }), anna({ facing: "right" })] },
			],
		});
		const bodies = result.panels[0]?.panel.bodies ?? [];
		expect(bodies[0]?.flip).toBe(true);
		expect(bodies[1]?.flip).toBe(false);
	});

	it("picks a different face for a wheel emotion than for neutral", () => {
		const neutral = compose({ version: 1, panels: [{ actors: [anna()] }] });
		const angry = compose({
			version: 1,
			panels: [{ actors: [anna({ emotion: "angry" })] }],
		});
		const first = neutral.panels[0]?.panel.bodies[0];
		const second = angry.panels[0]?.panel.bodies[0];
		expect(first?.kind).toBe("complex");
		expect(second?.kind).toBe("complex");
		if (first?.kind !== "complex" || second?.kind !== "complex") return;
		expect(second.faceIndex).not.toBe(first.faceIndex);
	});

	it("selects the gesture torso and still lets the emotion pick the face", () => {
		const result = compose({
			version: 1,
			panels: [{ actors: [anna({ gesture: "wave", emotion: "happy" })] }],
		});
		const body = result.panels[0]?.panel.bodies[0];
		expect(body?.kind).toBe("complex");
		if (body?.kind !== "complex") return;
		const data = avatars.find((entry) => entry.name === "anna");
		expect(data?.torsos[body.torsoIndex]?.emotion).toBe(EM_WAVE);
		expect(data?.faces[body.faceIndex]?.emotion).toBe(0);
		expect(data?.faces[body.faceIndex]?.intensity).toBeGreaterThan(0);
	});

	it("draws a closer shot than a wide one", () => {
		const wide = compose({
			version: 1,
			panels: [{ camera: "wide", actors: [anna()] }],
		});
		const close = compose({
			version: 1,
			panels: [{ camera: "close", actors: [anna()] }],
		});
		const wideBox = wide.panels[0]?.panel.bodies[0]?.bbox;
		const closeBox = close.panels[0]?.panel.bodies[0]?.bbox;
		expect(closeBox && wideBox).toBeTruthy();
		if (!wideBox || !closeBox) return;
		expect(closeBox.right - closeBox.left).toBeGreaterThan(
			wideBox.right - wideBox.left,
		);
	});

	it("scales a zoomed panel about the panel floor", () => {
		const plain = compose({ version: 1, panels: [{ actors: [anna()] }] });
		const zoomed = compose({
			version: 1,
			panels: [{ zoom: 2, actors: [anna()] }],
		});
		const before = plain.panels[0]?.panel.bodies[0]?.bbox;
		const after = zoomed.panels[0]?.panel.bodies[0]?.bbox;
		if (!before || !after) throw new Error("missing bodies");
		expect(after.bottom).toBe(before.bottom);
		expect(after.top - after.bottom).toBeCloseTo(
			2 * (before.top - before.bottom),
			-1,
		);
	});

	it("lays balloons out over their speakers", () => {
		const result = compose({
			version: 1,
			panels: [
				{
					actors: [
						anna({ text: "hello there" }),
						{ avatar: "bolo", text: "hi", mode: "think" },
					],
				},
			],
		});
		const panel = result.panels[0]?.panel;
		expect(panel?.balloons).toHaveLength(2);
		for (const balloon of panel?.balloons ?? []) {
			const runtime = balloon.runtime as
				| { bbox: { right: number } }
				| undefined;
			expect(runtime?.bbox.right).toBeGreaterThan(0);
			expect(panel?.bodies).toContain(balloon.speaker);
		}
	});

	it("upper-cases balloon text the way the engine does", () => {
		const result = compose({
			version: 1,
			panels: [{ actors: [anna({ text: "hello" })] }],
		});
		expect(result.panels[0]?.panel.balloons[0]?.text).toBe("HELLO");
	});

	it("carries the background and border onto the panel", () => {
		const result = compose({
			version: 1,
			panels: [{ background: "volcano", border: false, actors: [anna()] }],
		});
		expect(result.panels[0]?.panel.backdrop).toBe("volcano");
		expect(result.panels[0]?.panel.hasBorder).toBe(false);
	});

	it("honours the size choice", () => {
		expect(
			composeStrip({ version: 1, size: "classic", panels: [] } as Strip, {
				avatars,
				resolveStyle,
			}).unit,
		).toBe(CLASSIC_UNIT);
		expect(
			composeStrip({ version: 1, panels: [] } as Strip, {
				avatars,
				resolveStyle,
			}).unit,
		).toBe(MODERN_UNIT);
	});

	it("is deterministic and panel-local, so editing one panel leaves the others alone", () => {
		const base = {
			version: 1,
			panels: [
				{ actors: [anna({ text: "first panel line" })] },
				{ actors: [{ avatar: "bolo", text: "second panel line" }] },
			],
		};
		const edited = {
			version: 1,
			panels: [
				{ actors: [anna({ text: "a much longer first panel line here" })] },
				{ actors: [{ avatar: "bolo", text: "second panel line" }] },
			],
		};
		const before = compose(base).panels[1]?.panel.balloons[0]?.runtime;
		const after = compose(edited).panels[1]?.panel.balloons[0]?.runtime;
		expect(JSON.stringify(after)).toBe(JSON.stringify(before));
	});

	it("reports an unknown avatar and skips it", () => {
		const result = composeStrip(
			{
				version: 1,
				panels: [{ actors: [{ avatar: "ghost" }, { avatar: "anna" }] }],
			} as Strip,
			{ avatars, resolveStyle },
		);
		expect(result.issues[0]?.path).toBe("panels[0].actors[0].avatar");
		expect(result.panels[0]?.panel.bodies).toHaveLength(1);
	});
});
