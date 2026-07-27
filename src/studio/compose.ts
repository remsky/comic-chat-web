// Builds panels straight from a strip script: explicit cast, order, facing, and camera, with no auto panel breaking.

import { CLASSIC_UNIT, MODERN_UNIT } from "../browser/panelUnits.js";
import type { Avatar, AvatarBody, AvatarData } from "../engine/avatar.js";
import { AvatarRegistry } from "../engine/avatar.js";
import {
	layoutAvatarGeometry,
	type PlacedAvatar,
	type UnitPanel,
} from "../engine/panel.js";
import {
	type BalloonStyleResolver,
	layoutPanelBalloons,
	makeRuntimeBalloon,
} from "../engine/panelBalloon.js";
import { MsvcRand } from "../engine/rand.js";
import { type AvatarArt, avatarArtCache, NEUTRAL_KEY } from "./art.js";
import {
	emotionAngles,
	MODE_CODES,
	type Strip,
	type StripActor,
	type StripIssue,
	type StripPanel,
} from "./script.js";

export const DEFAULT_SEED = 1515;

export interface ComposedPanel {
	panel: UnitPanel;
	issues: StripIssue[];
}

export interface ComposeResult {
	unit: number;
	panels: ComposedPanel[];
	issues: StripIssue[];
}

export interface ComposeOptions {
	avatars: readonly AvatarData[];
	resolveStyle: BalloonStyleResolver;
	// pass the catalog's, so the studio probes each character once instead of once per render
	artFor?: (name: string) => AvatarArt;
}

function bodyForActor(
	avatar: Avatar,
	actor: StripActor,
	art: AvatarArt,
): AvatarBody {
	const named =
		art.faces[actor.emotion ?? NEUTRAL_KEY] ?? art.faces[NEUTRAL_KEY];
	// a gesture only ever swaps the torso; asking for one the character lacks leaves it standing neutral
	const gesture =
		actor.gesture === undefined
			? undefined
			: (art.torsos[actor.gesture] ?? art.torsos[NEUTRAL_KEY]);
	// the wheel builds the record, then the name it landed under says which drawing goes in it
	const body = avatar.getBodyFromEmotion(0, 0);
	if (body.kind === "simple") body.bodyIndex = gesture ?? named?.torso ?? 0;
	else {
		body.faceIndex = named?.face ?? body.faceIndex;
		body.torsoIndex = gesture ?? named?.torso ?? body.torsoIndex;
	}
	body.flip = actor.facing === "left";
	body.requested = true;
	return body;
}

// widens or tightens the shot around the panel floor, on top of whatever the engine camera picked
function applyZoom(
	placed: readonly PlacedAvatar[],
	zoom: number,
	unit: number,
) {
	if (zoom === 1) return;
	const pivotX = unit / 2;
	const floor = -unit;
	// plain rounding, not the engine's trunc-toward-zero round, so the floor stays put below y=0
	for (const entry of placed) {
		const box = entry.body.bbox;
		box.left = Math.round(pivotX + (box.left - pivotX) * zoom);
		box.right = Math.round(pivotX + (box.right - pivotX) * zoom);
		box.top = Math.round(floor + (box.top - floor) * zoom);
		box.bottom = Math.round(floor + (box.bottom - floor) * zoom);
		entry.body.arrowX = Math.round(
			pivotX + (entry.body.arrowX - pivotX) * zoom,
		);
	}
}

function composePanel(
	spec: StripPanel,
	index: number,
	registry: AvatarRegistry,
	rand: MsvcRand,
	unit: number,
	resolveStyle: BalloonStyleResolver,
	artFor: (name: string) => AvatarArt,
): ComposedPanel {
	const issues: StripIssue[] = [];
	const panel: UnitPanel = {
		seed: rand.rand(),
		hasBorder: spec.border !== false,
		backdropMode: 0,
		...(spec.background ? { backdrop: spec.background } : {}),
		bodies: [],
		balloons: [],
	};
	const placed: PlacedAvatar[] = [];
	const speakers: { actor: StripActor; body: AvatarBody }[] = [];

	spec.actors.forEach((actor, actorIndex) => {
		const avatar = registry.avatars.find(
			(candidate) => candidate.data.name === actor.avatar,
		);
		if (!avatar) {
			issues.push({
				path: `panels[${index}].actors[${actorIndex}].avatar`,
				message: `unknown avatar "${actor.avatar}"`,
				severity: "error",
			});
			return;
		}
		const body = bodyForActor(avatar, actor, artFor(actor.avatar));
		panel.bodies.push(body);
		placed.push({ avatar, body });
		if (actor.text) speakers.push({ actor, body });
	});

	if (placed.length === 0) return { panel, issues };

	const wide = (spec.camera ?? "wide") === "wide";
	layoutAvatarGeometry(placed, {
		unitWidth: unit,
		unitHeight: unit,
		establishing: wide,
		zoomIn: !wide,
	});
	applyZoom(placed, spec.zoom ?? 1, unit);

	for (const { actor, body } of speakers) {
		panel.balloons.push(
			makeRuntimeBalloon(
				actor.text ?? "",
				MODE_CODES[actor.mode ?? "say"],
				body,
				resolveStyle,
			),
		);
	}

	if (panel.balloons.length > 0) {
		const result = layoutPanelBalloons(panel, rand, {
			unitWidth: unit,
			unitHeight: unit,
			resolveStyle,
		});
		if (!result.fits)
			issues.push({
				path: `panels[${index}].actors`,
				message: "balloons do not fit; shorten the text or split the panel",
				severity: "error",
			});
		else if (result.leftover)
			issues.push({
				path: `panels[${index}].actors`,
				message: "text was truncated to fit the panel",
				severity: "warning",
			});
	}
	return { panel, issues };
}

export function composeStrip(
	strip: Strip,
	options: ComposeOptions,
): ComposeResult {
	const unit = strip.size === "classic" ? CLASSIC_UNIT : MODERN_UNIT;
	// a fresh registry per pass, and no recordBody, so a panel's poses depend only on its own actors
	const registry = new AvatarRegistry(options.avatars);
	const probed = avatarArtCache(options.avatars, emotionAngles());
	const artFor = options.artFor ?? probed;
	const seed = strip.seed ?? DEFAULT_SEED;
	const panels = strip.panels.map((spec, index) =>
		composePanel(
			spec,
			index,
			registry,
			new MsvcRand(seed + index),
			unit,
			options.resolveStyle,
			artFor,
		),
	);
	return {
		unit,
		panels,
		issues: panels.flatMap((composed) => composed.issues),
	};
}
