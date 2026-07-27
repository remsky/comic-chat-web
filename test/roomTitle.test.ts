// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { AvatarAtlasCache } from "../src/browser/avatarAssets.js";
import { BackdropCache } from "../src/browser/backdropAssets.js";
import { RoomView } from "../src/browser/roomView.js";
import type { Features } from "../src/browser/storage.js";
import type { AvatarData } from "../src/engine/avatar.js";
import { SM_SAY } from "../src/engine/panel.js";
import type { ChatEntry, RosterEntry } from "../src/protocol/room.js";

const fixture = JSON.parse(
	readFileSync(resolve(process.cwd(), "test/fixtures/avatars.json"), "utf8"),
) as { avatars: AvatarData[] };

// jsdom has no 2D context; measurement and card drawing only need these stubs
beforeAll(() => {
	const context2d = () =>
		new Proxy(
			{
				font: "",
				measureText: (text: string) => ({ width: text.length * 8 }),
			},
			{
				get(target, property) {
					if (property in target)
						return target[property as keyof typeof target];
					return () => {};
				},
				set() {
					return true;
				},
			},
		);
	class StubCanvas {
		getContext(): unknown {
			return context2d();
		}
	}
	(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StubCanvas;
	HTMLCanvasElement.prototype.getContext = context2d as never;
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
});

const FEATURES: Features = {
	modernSizing: true,
	sharedAvatars: true,
	mentionAutocomplete: true,
	addressedGestures: true,
	gestureCommands: true,
};

function mount(): { view: RoomView; container: HTMLElement } {
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
	view.setLocalUserId("u-me");
	return { view, container };
}

function seat(id: string, userId: string, name: string): RosterEntry {
	const avatar = fixture.avatars[0];
	if (!avatar) throw new Error("fixture has no avatars");
	return { id, userId, name, avatar: avatar.avatarID };
}

function chat(seq: number, userId: string, name: string): ChatEntry {
	const avatar = fixture.avatars[0];
	if (!avatar) throw new Error("fixture has no avatars");
	return {
		type: "chat",
		seq,
		userId,
		avatar: avatar.avatarID,
		name,
		text: "hello there",
		mode: SM_SAY,
		annotation: {
			faceIndex: 0,
			faceEmotionIndex: 0,
			faceIntensity: 0,
			torsoIndex: 0,
			torsoEmotionIndex: 0,
			torsoIntensity: 0,
			requested: false,
			talkTos: [],
		},
	};
}

describe("room title screen", () => {
	it("opens with a STARRING panel naming self first", () => {
		const { view, container } = mount();
		view.setShowTitle(true);
		view.setRoster([seat("s1", "u-other", "other"), seat("s2", "u-me", "me")]);
		const labels = [...container.querySelectorAll("canvas")].map((canvas) =>
			canvas.getAttribute("aria-label"),
		);
		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatch(/Title: /);
		expect(labels[0]).toMatch(/Starring: me, other/);
	});

	it("keeps the opener first as chat panels land, and drops it when toggled off", () => {
		const { view, container } = mount();
		view.setShowTitle(true);
		view.setRoster([seat("s2", "u-me", "me")]);
		view.compose(chat(1, "u-me", "me"));
		expect(container.querySelectorAll("figure.panel")).toHaveLength(2);
		expect(
			container.querySelector("canvas")?.getAttribute("aria-label"),
		).toMatch(/Title: /);
		view.setShowTitle(false);
		expect(container.querySelectorAll("figure.panel")).toHaveLength(1);
		expect(
			container.querySelector("canvas")?.getAttribute("aria-label"),
		).not.toMatch(/Title: /);
	});

	it("survives a history rebuild", () => {
		const { view, container } = mount();
		view.setShowTitle(true);
		view.setRoster([seat("s2", "u-me", "me")]);
		view.reset([chat(1, "u-me", "me")]);
		expect(container.querySelectorAll("figure.panel")).toHaveLength(2);
		expect(
			container.querySelector("canvas")?.getAttribute("aria-label"),
		).toMatch(/Title: /);
	});
});
