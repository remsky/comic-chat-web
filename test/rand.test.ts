import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MsvcRand } from "../src/engine/rand.js";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

// Independent BigInt model of the MSVC LCG, so the engine implementation is not self-certifying.
function referenceSequence(seed: number, n: number): number[] {
	const out: number[] = [];
	let state = BigInt(seed);
	for (let i = 0; i < n; i++) {
		state = (state * 214013n + 2531011n) & 0xffffffffn;
		out.push(Number((state >> 16n) & 0x7fffn));
	}
	return out;
}

describe("MsvcRand", () => {
	it("matches an independent BigInt model of the LCG", () => {
		const rng = new MsvcRand(1515);
		const got = Array.from({ length: 10_000 }, () => rng.rand());
		expect(got).toEqual(referenceSequence(1515, 10_000));
	});

	it("reproduces the oracle's panel seeds from srand(1515), in stream order", () => {
		const jsonl = readFileSync(
			new URL("../traces/smoke-01.jsonl", import.meta.url),
			"utf8",
		);
		const records = parseTrace(jsonl);
		const header = recordsOfType(records, "header")[0];
		expect(header?.srand).toBe(1515);

		const seeds = recordsOfType(records, "panel").map((p) => p.seed);
		expect(seeds[0]).toBe(4985);

		// Panel seeds are draws from one ongoing stream; layout consumes draws in between.
		const rng = new MsvcRand(header?.srand ?? 0);
		const stream = Array.from({ length: 1_000_000 }, () => rng.rand());
		let cursor = 0;
		for (const seed of seeds) {
			const at = stream.indexOf(seed, cursor);
			expect(
				at,
				`seed ${seed} not found after stream position ${cursor}`,
			).toBeGreaterThanOrEqual(0);
			cursor = at + 1;
		}
	});
});
