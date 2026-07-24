import { describe, expect, it } from "vitest";
import {
	parseAddressees,
	stripAddressPrefix,
} from "../src/browser/addressing.js";
import { EM_WAVE, EmotionEngine } from "../src/engine/emotion.js";

const speakers = new Map([
	["anna", 1],
	["bolo", 2],
	["cro", 3],
]);

describe("parseAddressees", () => {
	it("matches a name as a whole word regardless of case or punctuation", () => {
		expect(parseAddressees("hey Anna, look", speakers, 2)).toEqual([1]);
		expect(parseAddressees("BOLO: over here", speakers, 1)).toEqual([2]);
		expect(parseAddressees("@cro nice one", speakers, 1)).toEqual([3]);
	});

	it("follows speaker-map order and drops duplicates", () => {
		expect(parseAddressees("cro and anna and cro", speakers, 2)).toEqual([
			1, 3,
		]);
	});

	it("never addresses the speaker", () => {
		expect(parseAddressees("anna talking to herself", speakers, 1)).toEqual([]);
	});

	it("ignores names embedded inside longer words", () => {
		expect(parseAddressees("crossing the annals", speakers, 2)).toEqual([]);
	});
});

describe("stripAddressPrefix", () => {
	it("drops a known nick's address prefix", () => {
		expect(stripAddressPrefix("anna: bye", speakers)).toBe("bye");
		expect(stripAddressPrefix("BOLO , hello there", speakers)).toBe(
			"hello there",
		);
	});

	it("drops a prefix for a nick holding spaces, which the server allows", () => {
		const spaced = new Map([...speakers, ["mary jane", 4]]);
		expect(stripAddressPrefix("Mary Jane: bye", spaced)).toBe("bye");
	});

	it("leaves unknown nicks and mid-sentence colons alone", () => {
		expect(stripAddressPrefix("jo: bye", speakers)).toBe("jo: bye");
		expect(stripAddressPrefix("the deal is: bye", speakers)).toBe(
			"the deal is: bye",
		);
		expect(stripAddressPrefix("bye anna", speakers)).toBe("bye anna");
	});

	it("hands the greeting rules a message CheckStart would otherwise miss", () => {
		const engine = new EmotionEngine();
		expect(engine.getEmotionsFromString("anna: bye").opts).toEqual([]);
		expect(
			engine.getEmotionsFromString(stripAddressPrefix("anna: bye", speakers))
				.opts,
		).toContainEqual(
			expect.objectContaining({ emotion: EM_WAVE, priority: 3 }),
		);
	});
});
