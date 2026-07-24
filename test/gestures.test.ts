import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	availableGestures,
	gestureInsert,
	hasGesture,
	parseGesture,
} from "../src/browser/gestures.js";
import { type AvatarData, AvatarRegistry } from "../src/engine/avatar.js";
import { EM_SHRUG, EM_WAVE } from "../src/engine/emotion.js";

interface FixtureFile {
	avatars: AvatarData[];
}

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as FixtureFile;

const byName = (name: string): AvatarData => {
	const data = fixture.avatars.find((avatar) => avatar.name === name);
	if (!data) throw new Error(`missing fixture avatar: ${name}`);
	return data;
};

describe("parseGesture", () => {
	it("claims a leading command and keeps the rest as the balloon text", () => {
		expect(parseGesture("/wave")).toEqual({
			command: "wave",
			emotion: EM_WAVE,
			text: "",
		});
		expect(parseGesture("/Wave  see you tomorrow ")).toEqual({
			command: "wave",
			emotion: EM_WAVE,
			text: "see you tomorrow",
		});
	});

	it("ignores unknown commands and slashes that are not leading", () => {
		expect(parseGesture("/dance")).toBeNull();
		expect(parseGesture("and/or")).toBeNull();
		expect(parseGesture("well /shrug")).toBeNull();
	});
});

describe("hasGesture", () => {
	it("reports only the gesture art an avatar actually carries", () => {
		expect(hasGesture(byName("susan"), EM_SHRUG)).toBe(true);
		expect(hasGesture(byName("hugh"), EM_SHRUG)).toBe(false);
		expect(hasGesture(byName("hugh"), EM_WAVE)).toBe(true);
		expect(hasGesture(byName("connor"), EM_WAVE)).toBe(false);
	});
});

describe("availableGestures", () => {
	it("offers each character only the commands its art can strike", () => {
		expect(availableGestures(byName("susan"))).toEqual([
			"wave",
			"point",
			"pointself",
			"shrug",
		]);
		expect(availableGestures(byName("hugh"))).toEqual([
			"wave",
			"point",
			"pointself",
		]);
		expect(availableGestures(byName("connor"))).toEqual([]);
		expect(availableGestures(undefined)).toEqual([]);
	});

	it("inserts every offered command in a form the parser reads back", () => {
		for (const command of availableGestures(byName("susan"))) {
			const typed = gestureInsert(command);
			expect(typed.startsWith("/"), typed).toBe(true);
			expect(parseGesture(typed)).toEqual({
				command,
				emotion: expect.any(Number),
				text: "",
			});
		}
	});
});

describe("gesture poses versus the wheel", () => {
	const registry = new AvatarRegistry(fixture.avatars);

	it("selects the gesture torso from a request option", () => {
		const susan = registry.get(byName("susan").avatarID);
		const body = susan?.getBodyFromOptions([
			{ emotion: EM_SHRUG, intensity: 1, priority: 255 },
		]);
		expect(body?.kind).toBe("complex");
		if (body?.kind !== "complex") return;
		expect(byName("susan").torsos[body.torsoIndex]?.emotion).toBe(EM_SHRUG);
	});

	it("never reaches gesture art from a wheel drag, at any angle or intensity", () => {
		const susan = registry.get(byName("susan").avatarID);
		const torsos = byName("susan").torsos;
		for (let step = 0; step < 32; step++) {
			for (const intensity of [0, 0.25, 0.5, 0.75, 1]) {
				const body = susan?.getBodyFromEmotion(
					(step * 2 * Math.PI) / 32,
					intensity,
				);
				if (body?.kind !== "complex") continue;
				expect(torsos[body.torsoIndex]?.emotion).toBeLessThanOrEqual(7);
			}
		}
	});
});
