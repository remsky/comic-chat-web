// Editor helpers that consult the engine for layout the compose path doesn't control.

import { type AvatarData, AvatarRegistry } from "../engine/avatar.js";
import { chooseFacings, type PlacedAvatar } from "../engine/panel.js";
import { type AvatarArt, artNamesOf, torsoPose } from "./art.js";
import { bodyForActor } from "./compose.js";
import type {
	StripActor,
	StripCamera,
	StripFacing,
	StripPanel,
} from "./script.js";

export interface Suggester {
	facings: (panel: StripPanel) => StripFacing[];
	camera: (scenePanelsBefore: number) => StripCamera;
	snapshot: (actor: StripActor) => { emotion?: string; gesture?: string };
}

export function suggester(
	avatars: readonly AvatarData[],
	artFor: (name: string) => AvatarArt,
): Suggester {
	const registry = new AvatarRegistry(avatars);
	const find = (name: string) =>
		registry.avatars.find((entry) => entry.data.name === name);

	return {
		snapshot(actor) {
			const avatar = find(actor.avatar);
			if (!avatar) return {};
			const art = artFor(actor.avatar);
			const body = bodyForActor(avatar, actor, art);
			const names = artNamesOf(art, avatar.data, body);
			if (names.emotion === undefined) return names;
			const paired = art.faces[names.emotion]?.torso;
			const drawn = body.kind === "simple" ? body.bodyIndex : body.torsoIndex;
			if (
				paired !== undefined &&
				torsoPose(avatar.data, paired) === torsoPose(avatar.data, drawn)
			)
				return { emotion: names.emotion };
			return names;
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
