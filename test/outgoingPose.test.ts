// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AvatarAtlasCache } from "../src/browser/avatarAssets.js";
import { BackdropCache } from "../src/browser/backdropAssets.js";
import { RoomView } from "../src/browser/roomView.js";
import type { Features } from "../src/browser/storage.js";
import {
	AF_FROZEN,
	AF_UNFROZEN,
	type Avatar,
	type AvatarData,
} from "../src/engine/avatar.js";
import { EM_WAVE } from "../src/engine/emotion.js";

interface FixtureFile {
	avatars: AvatarData[];
}

// jsdom serves import.meta.url over http, so the fixture resolves from the project root
const fixture = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as FixtureFile;

// jsdom has no 2D context; the measurer only ever asks for text widths
beforeAll(() => {
	class StubCanvas {
		getContext(): unknown {
			return {
				font: "",
				measureText: (text: string) => ({ width: text.length * 8 }),
			};
		}
	}
	(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StubCanvas;
});

const FEATURES: Features = {
	modernSizing: true,
	sharedAvatars: true,
	mentionAutocomplete: true,
	addressedGestures: true,
	gestureCommands: true,
};

const waver = fixture.avatars.find((data) =>
	data.torsos.some((torso) => torso.emotion === EM_WAVE),
);

function mount(): { view: RoomView; avatar: Avatar; data: AvatarData } {
	if (!waver) throw new Error("no fixture avatar carries wave art");
	document.body.replaceChildren();
	const container = document.createElement("div");
	const scroller = document.createElement("div");
	document.body.append(container, scroller);
	const view = new RoomView(
		new AvatarAtlasCache(async () => ({}) as CanvasImageSource),
		new BackdropCache(),
		fixture.avatars,
		container,
		scroller,
		FEATURES,
	);
	view.setLocalUserId("u-1");
	view.setLocalAvatarID(waver.avatarID);
	const avatar = view.localAvatar();
	if (!avatar) throw new Error("local seat missing");
	return { view, avatar, data: waver };
}

const torsoEmotion = (avatar: Avatar, data: AvatarData): number | undefined =>
	data.torsos[avatar.getIndices().torsoIndex]?.emotion;

const faceIsNeutral = (avatar: Avatar, data: AvatarData): boolean => {
	const face = data.faces[avatar.getIndices().faceIndex];
	return face?.emotion === 0 && face.intensity === 0;
};

describe("prepareOutgoing pose selection", () => {
	it("gives the gesture the torso and leaves the face to the text rules", () => {
		const { view, avatar, data } = mount();
		view.prepareOutgoing("nice :-)", [], EM_WAVE);
		expect(torsoEmotion(avatar, data)).toBe(EM_WAVE);
		expect(faceIsNeutral(avatar, data)).toBe(false);
	});

	it("neutralizes the face for a gesture with nothing to say", () => {
		const { view, avatar, data } = mount();
		view.prepareOutgoing("<Chr>", [], EM_WAVE);
		expect(torsoEmotion(avatar, data)).toBe(EM_WAVE);
		expect(faceIsNeutral(avatar, data)).toBe(true);
	});

	it("keeps a frozen face while the gesture takes the torso", () => {
		const { view, avatar, data } = mount();
		const picked = data.faces.findIndex(
			(face) => face.emotion !== 0 || face.intensity !== 0,
		);
		avatar.setIndices(picked, 0, 1);
		avatar.freeze = AF_FROZEN;
		view.prepareOutgoing("<Chr>", [], EM_WAVE);
		expect(torsoEmotion(avatar, data)).toBe(EM_WAVE);
		expect(avatar.getIndices().faceIndex).toBe(picked);
	});

	it("leaves a frozen body alone when no gesture is sent", () => {
		const { view, avatar, data } = mount();
		const picked = data.faces.findIndex(
			(face) => face.emotion !== 0 || face.intensity !== 0,
		);
		avatar.setIndices(picked, 3, 1);
		avatar.freeze = AF_FROZEN;
		view.prepareOutgoing("nice :-)", []);
		expect(avatar.getIndices()).toMatchObject({
			faceIndex: picked,
			torsoIndex: 3,
		});
	});

	it("poses from the text alone when unfrozen and uncommanded", () => {
		const { view, avatar, data } = mount();
		expect(avatar.freeze).toBe(AF_UNFROZEN);
		view.prepareOutgoing("nice :-)", []);
		expect(faceIsNeutral(avatar, data)).toBe(false);
		expect(torsoEmotion(avatar, data)).not.toBe(EM_WAVE);
	});
});
