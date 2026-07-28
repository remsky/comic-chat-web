// What the chat rules engine would draw for a line, named so a form control can hold it.

import { type AvatarData, AvatarRegistry } from "../engine/avatar.js";
import { EmotionEngine } from "../engine/emotion.js";
import { chooseFacings, type PlacedAvatar } from "../engine/panel.js";
import {
	type AvatarArt,
	artNamesOf,
	NEUTRAL_KEY,
	splitArtName,
	torsoPose,
} from "./art.js";
import { bodyForActor } from "./compose.js";
import type { StripCamera, StripFacing, StripPanel } from "./script.js";

export interface ArtSuggestion {
	emotion?: string;
	gesture?: string;
}

export interface Suggester {
	art: (avatarName: string, text: string) => ArtSuggestion;
	facings: (panel: StripPanel) => StripFacing[];
	camera: (scenePanelsBefore: number) => StripCamera;
}

export function suggester(
	avatars: readonly AvatarData[],
	artFor: (name: string) => AvatarArt,
): Suggester {
	const registry = new AvatarRegistry(avatars);
	const emotions = new EmotionEngine();
	const find = (name: string) =>
		registry.avatars.find((entry) => entry.data.name === name);

	return {
		art(avatarName, text) {
			const avatar = find(avatarName);
			if (!avatar) return {};
			const art = artFor(avatarName);
			const body = avatar.getBodyFromOptions(
				emotions.getEmotionsFromString(text),
			);
			const names = artNamesOf(art, avatar.data, body);
			if (names.emotion === undefined) return names;
			// the face name already brings a torso, so only a different one is worth naming
			const paired = art.faces[names.emotion]?.torso;
			const drawn = body.kind === "simple" ? body.bodyIndex : body.torsoIndex;
			return paired !== undefined &&
				torsoPose(avatar.data, paired) === torsoPose(avatar.data, drawn)
				? { emotion: names.emotion }
				: names;
		},

		camera(scenePanelsBefore) {
			return scenePanelsBefore < 1 ? "wide" : "close";
		},

		facings(panel) {
			const placed: PlacedAvatar[] = [];
			for (const actor of panel.actors) {
				const avatar = find(actor.avatar);
				if (!avatar) continue;
				placed.push({
					avatar,
					body: bodyForActor(avatar, actor, artFor(actor.avatar)),
				});
			}
			chooseFacings(placed);
			return placed.map((entry) => (entry.body.flip ? "left" : "right"));
		},
	};
}

// "shout" and "shout_1" name the same face; undefined and "neutral" do too
export function sameEmotion(a?: string, b?: string): boolean {
	const key = (name?: string) => {
		if (name === undefined) return NEUTRAL_KEY;
		const { base, index } = splitArtName(name);
		return index === 1 ? base : name;
	};
	return key(a) === key(b);
}
