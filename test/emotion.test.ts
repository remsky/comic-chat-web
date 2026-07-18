import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	EM_HAPPY,
	EM_LAUGH,
	EM_POINTOTHER,
	EM_POINTSELF,
	EM_SHOUT,
	EM_WAVE,
	EmotionEngine,
} from "../src/engine/emotion.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const engine = new EmotionEngine();
const opts = (text: string) => engine.getEmotionsFromString(text).opts;

describe("EmotionEngine rules", () => {
	it("fires wave for greetings, case insensitively, with per-word strength", () => {
		expect(opts("Hello there Bolo!")).toEqual([
			{ emotion: EM_WAVE, intensity: 1, priority: 5 },
		]);
		expect(opts("hi everyone")).toEqual([
			{ emotion: EM_WAVE, intensity: 1, priority: 2 },
		]);
	});

	it("adds AllCaps shout and word rules in registration order", () => {
		expect(opts("WHAT DID YOU SAY?")).toEqual([
			{ emotion: EM_SHOUT, intensity: 1, priority: 9 },
			{ emotion: EM_POINTOTHER, intensity: 1, priority: 8 },
		]);
	});

	it("requires more than one uppercase letter and no lowercase for shout", () => {
		expect(opts("A?")).toEqual([]);
		expect(opts("Ab CD")).toEqual([]);
	});

	it("matches laugh words case sensitively and dedups by emotion", () => {
		expect(opts("okay LOL yes ROTFL indeed")).toEqual([
			{ emotion: EM_LAUGH, intensity: 1, priority: 11 },
		]);
		expect(opts("lol nothing")).toEqual([]);
	});

	it("finds smileys anywhere via FindString", () => {
		expect(opts("nice :-)")).toEqual([
			{ emotion: EM_HAPPY, intensity: 1, priority: 10 },
		]);
	});

	it("fires CheckStart('I') only at the string start", () => {
		expect(opts("I wonder if he knows about the treasure")).toEqual([
			{ emotion: EM_POINTSELF, intensity: 1, priority: 3 },
		]);
		expect(opts("psst, I heard that")).toEqual([]);
	});

	it("preserves the sentence-loop bug: later sentences test the string start", () => {
		expect(opts("Hello world. You rock")).toEqual([
			{ emotion: EM_WAVE, intensity: 1, priority: 5 },
		]);
	});

	it("requires word boundaries for CheckWord", () => {
		expect(opts("PLOL")).toEqual([
			{ emotion: EM_SHOUT, intensity: 1, priority: 9 },
		]);
		expect(opts("that was LOLzy")).toEqual([]);
	});
});

describe("smoke-01 emotion records", () => {
	const records = parseTrace(
		readFileSync(new URL("../traces/smoke-01.jsonl", import.meta.url), "utf8"),
	);

	// Trace priorities are all 0 because GetBodyFromEmotion consumes them before the hook; compare emotion and intensity.
	it("reproduces every opts list from the oracle, in order", () => {
		expect(recordsOfType(records, "emotion")).toHaveLength(8);
		let lastMessage = "";
		for (const rec of records) {
			if (rec.type === "message") lastMessage = rec.text;
			if (rec.type !== "emotion") continue;
			const got = engine.getEmotionsFromString(lastMessage).opts;
			expect(got, `opts count for "${lastMessage}"`).toHaveLength(
				rec.opts.length,
			);
			got.forEach((opt, k) => {
				expect(
					Number(opt.emotion.toFixed(6)),
					`emotion ${k} for "${lastMessage}"`,
				).toBe(rec.opts[k]?.[0]);
				expect(
					Number(opt.intensity.toFixed(6)),
					`intensity ${k} for "${lastMessage}"`,
				).toBe(rec.opts[k]?.[1]);
			});
		}
	});
});
