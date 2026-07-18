import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrace, recordsOfType } from "../src/trace/format.js";

const jsonl = readFileSync(
	new URL("../traces/smoke-01.jsonl", import.meta.url),
	"utf8",
);

describe("smoke-01 golden trace", () => {
	const records = parseTrace(jsonl);

	it("parses every line and is well formed", () => {
		expect(records.length).toBeGreaterThan(200);
		expect(records[0]?.type).toBe("header");
		expect(records.at(-1)).toEqual({ type: "end", messages: 8 });
	});

	it("has the expected cast and panel structure", () => {
		expect(recordsOfType(records, "cast").map((c) => c.name)).toEqual([
			"anna",
			"bolo",
		]);
		expect(recordsOfType(records, "panel")).toHaveLength(11);
		expect(recordsOfType(records, "message")).toHaveLength(8);
		expect(recordsOfType(records, "textExtent")).toHaveLength(243);
	});

	it("panel child records agree with panel counts", () => {
		for (const panel of recordsOfType(records, "panel")) {
			const bodies = recordsOfType(records, "body").filter(
				(b) => b.panel === panel.panel,
			);
			expect(bodies).toHaveLength(panel.nBodies);
		}
	});
});
