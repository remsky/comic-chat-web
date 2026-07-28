// What the chat rules engine would draw for a line, named so a form control can hold it.

import { type AvatarData, AvatarRegistry } from "../engine/avatar.js";
import { EmotionEngine } from "../engine/emotion.js";
import { chooseFacings, type PlacedAvatar } from "../engine/panel.js";
import { type AvatarArt, artNamesOf, NEUTRAL_KEY, torsoPose } from "./art.js";
import { bodyForActor } from "./compose.js";
import type { StripFacing, StripPanel } from "./script.js";

export interface ArtSuggestion {
	emotion?: string;
	gesture?: string;
}

export interface Suggester {
	art: (avatarName: string, text: string) => ArtSuggestion;
	facings: (panel: StripPanel) => StripFacing[];
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

// an absent emotion and the first neutral both name the resting face
export function sameEmotion(a?: string, b?: string): boolean {
	const key = (name?: string) =>
		name === undefined || name === `${NEUTRAL_KEY}_1` ? NEUTRAL_KEY : name;
	return key(a) === key(b);
}
