import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	AF_FROZEN,
	AF_TEMPFROZEN,
	AF_UNFROZEN,
	type AvatarData,
	AvatarRegistry,
} from "../src/engine/avatar.js";
import {
	BodyCamModel,
	cacheBullSide,
	emotionNameIndex,
	getEmotionFromPoint,
	getIconRect,
	getPointFromEmotion,
	iconHitTest,
	stringFromEmotion,
	wheelLayout,
} from "../src/engine/bodycam.js";
import { EM_BORED, EM_COY, EM_SCARED } from "../src/engine/emotion.js";
import { PI } from "../src/engine/vector2d.js";

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/avatars.json", import.meta.url), "utf8"),
) as { avatars: AvatarData[] };

// full-width sidebar wheel: MAXBULL square, bullseye at (79, bottom - 79)
const RECT = { left: 0, top: 0, right: 159, bottom: 240 };
const LAYOUT = wheelLayout(RECT, 159);

describe("cacheBullSide", () => {
	it("clamps to MAXBULL and disables below MINBULL", () => {
		expect(cacheBullSide(400)).toEqual({ bullSide: 159, bullDisabled: false });
		expect(cacheBullSide(159)).toEqual({ bullSide: 159, bullDisabled: false });
		expect(cacheBullSide(120)).toEqual({ bullSide: 120, bullDisabled: false });
		expect(cacheBullSide(93)).toEqual({ bullSide: 93, bullDisabled: false });
		expect(cacheBullSide(92)).toEqual({ bullSide: 93, bullDisabled: true });
	});
});

describe("wheelLayout", () => {
	it("derives the DrawBullsEye geometry", () => {
		expect(LAYOUT.bullsEye).toEqual({ x: 79, y: 161 });
		// halfSide 79 - cursor 5 - icon 26 = 48; cursor shrink leaves 43
		expect(LAYOUT.circleRadius).toBe(48);
		expect(LAYOUT.bullRadius).toBe(43);
	});
});

describe("getEmotionFromPoint", () => {
	it("is neutral at the bullseye", () => {
		expect(getEmotionFromPoint({ x: 79, y: 161 }, LAYOUT)).toEqual({
			emotion: 0,
			intensity: 0,
		});
	});

	it("keeps the 0.2 detente around the center", () => {
		// 8/43 = 0.186 snaps to neutral; 9/43 = 0.209 doesn't
		expect(getEmotionFromPoint({ x: 87, y: 161 }, LAYOUT)).toEqual({
			emotion: 0,
			intensity: 0,
		});
		expect(getEmotionFromPoint({ x: 88, y: 161 }, LAYOUT)).toEqual({
			emotion: 0,
			intensity: Math.fround(9 / 43),
		});
	});

	it("clamps intensity to 1 and angles with atan2", () => {
		expect(getEmotionFromPoint({ x: 122, y: 161 }, LAYOUT)).toEqual({
			emotion: 0,
			intensity: 1,
		});
		expect(getEmotionFromPoint({ x: 79, y: 300 }, LAYOUT)).toEqual({
			emotion: Math.fround(Math.PI / 2),
			intensity: 1,
		});
		expect(getEmotionFromPoint({ x: -100, y: 161 }, LAYOUT)).toEqual({
			emotion: Math.fround(Math.PI),
			intensity: 1,
		});
	});
});

describe("getPointFromEmotion", () => {
	it("round-trips full-intensity points on the axis", () => {
		expect(getPointFromEmotion({ emotion: 0, intensity: 1 }, LAYOUT)).toEqual({
			x: 122,
			y: 161,
		});
		// engine PI/2 truncation: cos leaks ~1.2e-6, ROUND absorbs it
		expect(
			getPointFromEmotion(
				{ emotion: Math.fround(PI / 2), intensity: 1 },
				LAYOUT,
			),
		).toEqual({ x: 79, y: 204 });
	});
});

describe("icon ring", () => {
	it("places happy on the east spoke at offset 66", () => {
		// offset = 43 + 2*5 + 13 = 66 → center (145, 161)
		expect(getIconRect(0, LAYOUT)).toEqual({
			left: 135,
			right: 155,
			bottom: 148,
			top: 174,
		});
	});

	it("hit-tests with inclusive flipped-rect edges", () => {
		expect(iconHitTest({ x: 145, y: 161 }, LAYOUT)).toBe(0);
		expect(iconHitTest({ x: 135, y: 148 }, LAYOUT)).toBe(0);
		expect(iconHitTest({ x: 134, y: 161 }, LAYOUT)).toBe(-1);
		expect(iconHitTest({ x: 79, y: 161 }, LAYOUT)).toBe(-1);
	});
});

describe("stringFromEmotion", () => {
	it("names the wheel octants like bodycam.cpp:257", () => {
		expect(stringFromEmotion({ emotion: 0, intensity: 0 })).toBe("Neutral");
		expect(stringFromEmotion({ emotion: 0, intensity: 0.5 })).toBe("Happy");
		expect(stringFromEmotion({ emotion: EM_COY, intensity: 1 })).toBe("Coy");
		expect(stringFromEmotion({ emotion: EM_BORED, intensity: 1 })).toBe(
			"Bored",
		);
		expect(stringFromEmotion({ emotion: EM_SCARED, intensity: 1 })).toBe(
			"Scared",
		);
		// atan2 output is (-PI, PI], so the west half arrives as negatives
		expect(stringFromEmotion({ emotion: Math.PI, intensity: 1 })).toBe("Sad");
		expect(
			stringFromEmotion({ emotion: (-3 * Math.PI) / 4, intensity: 1 }),
		).toBe("Angry");
		expect(stringFromEmotion({ emotion: -Math.PI / 2, intensity: 1 })).toBe(
			"Shout",
		);
		expect(stringFromEmotion({ emotion: -Math.PI / 4, intensity: 1 })).toBe(
			"Laugh",
		);
	});

	it("keeps the exact octant boundary comparisons", () => {
		expect(emotionNameIndex({ emotion: PI / 8, intensity: 1 })).toBe(0);
		expect(
			emotionNameIndex({
				emotion: Math.fround((PI / 8) * 1.001),
				intensity: 1,
			}),
		).toBe(1);
		expect(emotionNameIndex({ emotion: -PI / 8, intensity: 1 })).toBe(7);
		expect(emotionNameIndex({ emotion: (7 * PI) / 8, intensity: 1 })).toBe(4);
		// exactly -7PI/8 fails the strict < and falls through to Angry
		expect(emotionNameIndex({ emotion: (-7 * PI) / 8, intensity: 1 })).toBe(5);
	});
});

describe("BodyCamModel", () => {
	it("quantizes updates to cursor pixels", () => {
		const model = new BodyCamModel();
		model.setRect(RECT);
		expect(model.bullDisabled).toBe(false);
		expect(model.cursorPos).toEqual({ x: 79, y: 161 });
		expect(model.updateEmotion({ emotion: 0, intensity: 0.5 })).toBe(true);
		expect(model.cursorPos).toEqual({ x: 101, y: 161 });
		// 21.5 vs 21.7 both round to pixel 22: no change registered
		expect(model.updateEmotion({ emotion: 0, intensity: 0.505 })).toBe(false);
		expect(model.emotion.intensity).toBe(0.5);
	});

	it("replots the cursor from the emotion on resize", () => {
		const model = new BodyCamModel();
		model.setRect(RECT);
		model.updateEmotion({ emotion: 0, intensity: 1 });
		model.setRect({ left: 0, top: 0, right: 120, bottom: 240 });
		// bullSide 120: halfSide 60, radius 60-5-26-5 = 24
		expect(model.cursorPos).toEqual({ x: 60 + 24, y: 240 - 60 });
	});
});

describe("Avatar.setIndices", () => {
	it("applies bounded indices and the requested flag on complex avatars", () => {
		const data = fixture.avatars.find((avatar) => avatar.type === "complex");
		if (!data) throw new Error("fixture has no complex avatar");
		const registry = new AvatarRegistry(fixture.avatars);
		const avatar = registry.get(data.avatarID);
		if (avatar?.body?.kind !== "complex") throw new Error("expected complex");
		avatar.setIndices(2, 3, 1);
		expect(avatar.body.faceIndex).toBe(2);
		expect(avatar.body.torsoIndex).toBe(3);
		expect(avatar.body.requested).toBe(true);
		avatar.setIndices(200, 200, 0);
		expect(avatar.body.faceIndex).toBe(2);
		expect(avatar.body.torsoIndex).toBe(3);
		expect(avatar.body.requested).toBe(false);
	});

	it("maps the torso slot onto simple avatar bodies", () => {
		const data = fixture.avatars.find((avatar) => avatar.type === "simple");
		if (!data) throw new Error("fixture has no simple avatar");
		const registry = new AvatarRegistry(fixture.avatars);
		const avatar = registry.get(data.avatarID);
		if (avatar?.body?.kind !== "simple") throw new Error("expected simple");
		avatar.setIndices(0, 1, 1);
		expect(avatar.body.bodyIndex).toBe(1);
		expect(avatar.body.requested).toBe(true);
	});
});

describe("freeze gating", () => {
	it("mirrors ResetAvatar's temp-freeze decay", () => {
		const registry = new AvatarRegistry(fixture.avatars);
		const avatar = registry.get(1);
		if (!avatar) throw new Error("missing avatar 1");
		avatar.freeze = AF_TEMPFROZEN;
		avatar.reset();
		expect(avatar.freeze).toBe(AF_UNFROZEN);
		avatar.freeze = AF_FROZEN;
		avatar.reset();
		expect(avatar.freeze).toBe(AF_FROZEN);
	});
});
