// Builds panels straight from a strip script: explicit cast, order, facing, and camera, with no auto panel breaking.

import { GESTURE_EMOTIONS } from "../browser/gestures.js";
import { CLASSIC_UNIT, MODERN_UNIT } from "../browser/panelUnits.js";
import type { Avatar, AvatarBody, AvatarData } from "../engine/avatar.js";
import { AvatarRegistry } from "../engine/avatar.js";
import { EmotionOpts } from "../engine/emotion.js";
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
import {
	emotionVector,
	MODE_CODES,
	type Strip,
	type StripActor,
	type StripIssue,
	type StripPanel,
} from "./script.js";

export const DEFAULT_SEED = 1515;

// twips of air over the first line, which the original balloon gave half of what it gave the other edges
const TEXT_TOP_PAD = 40;

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
}

function bodyForActor(avatar: Avatar, actor: StripActor): AvatarBody {
	const wheel = emotionVector(actor.emotion ?? "neutral", actor.intensity);
	const gesture = actor.gesture
		? GESTURE_EMOTIONS.get(actor.gesture)
		: undefined;
	let body: AvatarBody;
	if (gesture === undefined) {
		body = avatar.getBodyFromEmotion(
			wheel?.emotion ?? 0,
			wheel?.intensity ?? 0,
		);
	} else {
		// a gesture only carries a torso, so the wheel emotion still gets to pick the face
		const opts = new EmotionOpts();
		opts.add(gesture, 1, 255);
		if (wheel && wheel.intensity > 0)
			opts.add(wheel.emotion, wheel.intensity, 128);
		body = avatar.getBodyFromOptions(opts);
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
		const body = bodyForActor(avatar, actor);
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
	const seed = strip.seed ?? DEFAULT_SEED;
	// padded here alone, so chat panels stay pinned to the traces
	const resolveStyle: BalloonStyleResolver = (text, mode) => ({
		...options.resolveStyle(text, mode),
		topPad: TEXT_TOP_PAD,
	});
	const panels = strip.panels.map((spec, index) =>
		composePanel(
			spec,
			index,
			registry,
			new MsvcRand(seed + index),
			unit,
			resolveStyle,
		),
	);
	return {
		unit,
		panels,
		issues: panels.flatMap((composed) => composed.issues),
	};
}
