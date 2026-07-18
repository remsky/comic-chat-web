import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import type { TextMeasure } from "../src/engine/balloonText.js";
import { EmotionEngine } from "../src/engine/emotion.js";
import { PanelPage, SM_WHISPER } from "../src/engine/panel.js";
import {
	BalloonRuntime,
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../src/engine/panelBalloon.js";
import { MsvcRand } from "../src/engine/rand.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

function measureFrom(map: Map<string, number>, cy: number): TextMeasure {
	return (text) => {
		const cx = map.get(text);
		if (cx === undefined)
			throw new Error(`no oracle metric for ${JSON.stringify(text)}`);
		return { cx, cy };
	};
}

const traceNames = readdirSync(new URL("../traces/", import.meta.url))
	.filter((name) => name.endsWith(".jsonl"))
	.sort();

describe.each(traceNames)("%s integrated balloon layout", (name) => {
	it("derives retries, splits, geometry, and panel seeds", () => {
		const records = parseTrace(
			readFileSync(new URL(`../traces/${name}`, import.meta.url), "utf8"),
		);
		const header = recordsOfType(records, "header")[0];
		if (!header) throw new Error("trace has no header");
		const metrics = new Map<string, Map<string, number>>();
		for (const record of recordsOfType(records, "textExtent")) {
			const key = `${record.fontFace}#${record.cy}`;
			let map = metrics.get(key);
			if (!map) {
				map = new Map();
				metrics.set(key, map);
			}
			map.set(record.str, record.cx);
		}
		const normalMap = metrics.get("Comic Sans MS#397");
		const whisperMap = metrics.get("Comic Sans MS#384") ?? normalMap;
		const systemMap = metrics.get("System#212");
		if (!normalMap || !whisperMap || !systemMap)
			throw new Error("trace lacks required font metrics");
		const normalMeasure = measureFrom(normalMap, 397);
		const whisperMeasure = measureFrom(whisperMap, 384);
		const systemMeasure = measureFrom(systemMap, 212);
		const registry = new AvatarRegistry(fixture.avatars);
		const emotions = new EmotionEngine();
		const expectedDecisions = recordsOfType(records, "panelDecision");
		const expectedRetries = recordsOfType(records, "panelRetry");
		const expectedPanels = recordsOfType(records, "panel");
		const expectedBalloons = recordsOfType(records, "balloon");
		let decisionIndex = 0;
		let retryIndex = 0;
		let panelIndex = 0;
		const layoutOptions = {
			unitWidth: header.unitWidth,
			unitHeight: header.unitHeight,
			resolveStyle: (_text: string, mode: number) => {
				const whisper = mode === SM_WHISPER;
				return {
					measure: whisper ? whisperMeasure : normalMeasure,
					widestMeasure: systemMeasure,
					font: {
						lineHeight: (whisper ? 384 : 397) - 70,
						baseAdd: 60,
						leading: -70,
					},
				};
			},
		};
		const page = new PanelPage({
			registry,
			rand: new MsvcRand(header.srand),
			unitWidth: header.unitWidth,
			unitHeight: header.unitHeight,
			panelsAtStart: header.panelsAtStart,
			hooks: {
				makeBalloon: (text, mode, speaker) =>
					makeRuntimeBalloon(text, mode, speaker, layoutOptions.resolveStyle),
				layoutBalloons: (panel, rand) =>
					layoutPanelBalloons(panel, rand, layoutOptions),
				onDecision: (decision) => {
					const expected = expectedDecisions[decisionIndex++];
					expect(decision, `${name} decision ${decisionIndex - 1}`).toEqual({
						cloned: expected?.cloned !== 0,
						speaker: expected?.speaker,
						words: expected?.words,
					});
				},
				onRetry: () => {
					retryIndex++;
				},
				onCommit: (panel) => {
					const expectedPanel = expectedPanels[panelIndex++];
					if (!expectedPanel) throw new Error("unexpected panel commit");
					expect(panel.seed, `${name} panel ${expectedPanel.panel} seed`).toBe(
						expectedPanel.seed,
					);
					const balloons = expectedBalloons
						.filter((balloon) => balloon.panel === expectedPanel.panel)
						.sort((a, b) => a.i - b.i);
					expect(panel.balloons).toHaveLength(balloons.length);
					for (let i = 0; i < balloons.length; i++) {
						const balloon = panel.balloons[i];
						const expected = balloons[i];
						if (!balloon || !expected) continue;
						if (!(balloon.runtime instanceof BalloonRuntime))
							throw new Error("missing balloon runtime");
						if ((balloon.runtime.spline?.cps.length ?? 0) > 100) {
							expect(
								{
									text: balloon.text,
									bbox: [
										balloon.runtime.bbox.left,
										balloon.runtime.bbox.right,
										balloon.runtime.bbox.top,
									],
									routeRgn: [
										balloon.runtime.routeRgn.left,
										balloon.runtime.routeRgn.right,
									],
								},
								`${name} panel ${expectedPanel.panel} oversized balloon ${i}`,
							).toEqual({
								text: expected.text,
								bbox: [expected.bbox[0], expected.bbox[2], expected.bbox[3]],
								routeRgn: expected.routeRgn,
							});
							continue;
						}
						expect(
							{
								text: balloon.text,
								bbox: [
									balloon.runtime.bbox.left,
									balloon.runtime.bbox.bottom,
									balloon.runtime.bbox.right,
									balloon.runtime.bbox.top,
								],
								trueBox: [
									balloon.runtime.trueBox.left,
									balloon.runtime.trueBox.bottom,
									balloon.runtime.trueBox.right,
									balloon.runtime.trueBox.top,
								],
								routeRgn: [
									balloon.runtime.routeRgn.left,
									balloon.runtime.routeRgn.right,
								],
							},
							`${name} panel ${expectedPanel.panel} balloon ${i}`,
						).toEqual({
							text: expected.text,
							bbox: expected.bbox,
							trueBox: expected.trueBox,
							routeRgn: expected.routeRgn,
						});
					}
				},
			},
		});

		for (const message of recordsOfType(records, "message")) {
			const avatar = registry.get(message.speaker);
			if (!avatar) throw new Error(`missing avatar ${message.speaker}`);
			avatar.updateBody(
				avatar.getBodyFromOptions(emotions.getEmotionsFromString(message.text)),
			);
			page.addLine(message.speaker, message.text, message.mode);
		}
		expect(decisionIndex).toBe(expectedDecisions.length);
		expect(retryIndex).toBe(expectedRetries.length);
		expect(panelIndex).toBe(expectedPanels.length);
	});
});
