import { describe, expect, it } from "vitest";
import { freezeStatusText } from "../src/browser/bodycamWidget.js";
import { AF_FROZEN, AF_TEMPFROZEN, AF_UNFROZEN } from "../src/engine/avatar.js";

describe("bodycam freeze status", () => {
	it("names each lock state for the status strip", () => {
		expect(freezeStatusText(AF_FROZEN)).toBe("Expression frozen");
		expect(freezeStatusText(AF_TEMPFROZEN)).toBe("Holding pose");
		expect(freezeStatusText(AF_UNFROZEN)).toBeNull();
	});
});
