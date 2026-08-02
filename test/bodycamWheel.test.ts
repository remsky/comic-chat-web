// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AvatarAtlasCache } from "../src/browser/avatarAssets.js";
import { BodyCamWidget } from "../src/browser/bodycamWidget.js";
import {
	AF_FROZEN,
	AF_TEMPFROZEN,
	AF_UNFROZEN,
	type Avatar,
	type AvatarData,
	createAvatar,
} from "../src/engine/avatar.js";
import { getPointFromEmotion, wheelLayout } from "../src/engine/bodycam.js";

const fixture = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

const WIDTH = 159;

// jsdom has no ResizeObserver, no image decoding, and no pointer capture; the widget only needs them to not throw
beforeAll(() => {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe(): void {}
		disconnect(): void {}
	};
	HTMLImageElement.prototype.decode = () => Promise.reject(new Error("stub"));
	HTMLCanvasElement.prototype.getContext = () => null;
	HTMLElement.prototype.setPointerCapture = () => {};
	HTMLElement.prototype.releasePointerCapture = () => {};
});

function pointer(type: string, x: number, y: number): MouseEvent {
	const event = new MouseEvent(type, { button: 0 });
	Object.defineProperty(event, "offsetX", { value: x });
	Object.defineProperty(event, "offsetY", { value: y });
	Object.defineProperty(event, "pointerId", { value: 1 });
	return event;
}

function mount(): {
	widget: BodyCamWidget;
	avatar: Avatar;
	canvas: HTMLElement;
} {
	const data = fixture.avatars.find((entry) => entry.type === "complex");
	if (!data) throw new Error("no complex avatar in the fixture");
	const avatar = createAvatar(data);
	document.body.replaceChildren();
	const canvas = document.createElement("canvas");
	Object.defineProperty(canvas, "clientWidth", { value: WIDTH });
	const lockButton = document.createElement("button");
	const sendButton = document.createElement("button");
	document.body.append(canvas, lockButton, sendButton);
	const widget = new BodyCamWidget({
		canvas,
		lockButton,
		sendButton,
		atlases: {} as AvatarAtlasCache,
		getAvatar: () => avatar,
		sendExpression: () => true,
		forwardTyping: () => {},
	});
	return { widget, avatar, canvas };
}

// the widget lays itself out from the client width, so the wheel maths here match what it hit-tests
const layout = wheelLayout(
	{ left: 0, top: 0, right: WIDTH, bottom: 130 + WIDTH },
	WIDTH,
);
const ANGRY = getPointFromEmotion(
	{ emotion: (5 * 2 * Math.PI) / 8, intensity: 1 },
	layout,
);

const indices = (avatar: Avatar): string => JSON.stringify(avatar.getIndices());

const isNeutral = (avatar: Avatar, data: AvatarData): boolean => {
	const { faceIndex, torsoIndex } = avatar.getIndices();
	const face = data.faces[faceIndex];
	const torso = data.torsos[torsoIndex];
	return (
		face?.emotion === 0 &&
		face.intensity === 0 &&
		torso?.emotion === 0 &&
		torso.intensity === 0
	);
};

describe("the emotion wheel across a send", () => {
	it("recenters once the message unfroze the avatar", () => {
		const { widget, avatar, canvas } = mount();
		const data = avatar.data;
		canvas.dispatchEvent(pointer("pointerdown", ANGRY.x, ANGRY.y));
		canvas.dispatchEvent(pointer("pointerup", ANGRY.x, ANGRY.y));
		expect(avatar.freeze).toBe(AF_TEMPFROZEN);
		const posed = indices(avatar);
		expect(isNeutral(avatar, data)).toBe(false);

		// what PanelPage.addLine does to the speaker once the entry composes
		avatar.reset();
		widget.refresh();
		expect(avatar.freeze).toBe(AF_UNFROZEN);
		expect(isNeutral(avatar, data)).toBe(true);

		// the same pixel has to pose the avatar again, not read as "no cursor movement"
		canvas.dispatchEvent(pointer("pointerdown", ANGRY.x, ANGRY.y));
		expect(indices(avatar)).toBe(posed);
	});

	it("leaves a locked wheel where the user put it", () => {
		const { widget, avatar, canvas } = mount();
		const data = avatar.data;
		canvas.dispatchEvent(pointer("pointerdown", ANGRY.x, ANGRY.y));
		canvas.dispatchEvent(pointer("pointerup", ANGRY.x, ANGRY.y));
		avatar.freeze = AF_FROZEN;
		widget.refresh();

		avatar.reset();
		widget.restore();
		expect(avatar.freeze).toBe(AF_FROZEN);
		expect(isNeutral(avatar, data)).toBe(false);
	});
});
