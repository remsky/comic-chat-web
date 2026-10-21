import { describe, expect, it } from "vitest";
import { base64urlDecode, base64urlEncode } from "../src/protocol/base64url.js";

describe("base64url", () => {
	it("round-trips every padding length without padding or the +/ alphabet", () => {
		for (const bytes of [[], [251], [251, 255], [251, 255, 190]]) {
			const encoded = base64urlEncode(Uint8Array.from(bytes));
			expect(encoded).toMatch(/^[\w-]*$/);
			expect([...base64urlDecode(encoded)]).toEqual(bytes);
		}
		expect(base64urlEncode(Uint8Array.of(251, 255, 190))).toBe("-_--");
	});
});
