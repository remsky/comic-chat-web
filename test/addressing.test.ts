import { describe, expect, it } from "vitest";
import { parseAddressees } from "../src/browser/addressing.js";

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
