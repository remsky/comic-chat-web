// The studio strip format: an explicit panel list, validated against the loaded cast.

import { availableGestures, GESTURE_EMOTIONS } from "../browser/gestures.js";
import type { AvatarData } from "../engine/avatar.js";
import { EMOTION_NAMES } from "../engine/bodycam.js";
import {
	EM_ANGRY,
	EM_BORED,
	EM_COY,
	EM_HAPPY,
	EM_LAUGH,
	EM_SAD,
	EM_SCARED,
	EM_SHOUT,
} from "../engine/emotion.js";
import { SM_ACTION, SM_SAY, SM_THINK, SM_WHISPER } from "../engine/panel.js";
import { type EmotionDegrees, emotionDegreeCache } from "./degrees.js";

export const STRIP_VERSION = 1;

// CUnitPanelPage caps both at 5 (panel.cpp:421, 438)
export const MAX_ACTORS = 5;
export const MAX_BALLOONS = 5;

export const STRIP_MODES = ["say", "think", "whisper", "action"] as const;
export type StripMode = (typeof STRIP_MODES)[number];

export const STRIP_CAMERAS = ["wide", "close"] as const;
export type StripCamera = (typeof STRIP_CAMERAS)[number];

export const STRIP_FACINGS = ["left", "right"] as const;
export type StripFacing = (typeof STRIP_FACINGS)[number];

export const STRIP_SIZES = ["classic", "modern"] as const;
export type StripSize = (typeof STRIP_SIZES)[number];

export const COLUMNS_DEFAULT = 4;
export const COLUMNS_MIN = 1;
export const COLUMNS_MAX = 8;

export const EMOTION_KEYS = EMOTION_NAMES.map((name) =>
	name.toLowerCase(),
) as readonly string[];

const EMOTION_ANGLES: readonly number[] = [
	EM_HAPPY,
	EM_COY,
	EM_BORED,
	EM_SCARED,
	EM_SAD,
	EM_ANGRY,
	EM_SHOUT,
	EM_LAUGH,
];

export const NEUTRAL_KEY = "neutral";

export const MODE_CODES: Record<StripMode, number> = {
	say: SM_SAY,
	think: SM_THINK,
	whisper: SM_WHISPER,
	action: SM_ACTION,
};

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

export interface StripActor {
	avatar: string;
	text?: string;
	mode?: StripMode;
	emotion?: string;
	intensity?: number;
	gesture?: string;
	facing?: StripFacing;
}

export interface StripPanel {
	background?: string;
	camera?: StripCamera;
	zoom?: number;
	border?: boolean;
	actors: StripActor[];
}

export interface Strip {
	version: number;
	size?: StripSize;
	seed?: number;
	// panels per row, on the sheet and in the preview alike
	columns?: number;
	panels: StripPanel[];
}

export interface StripIssue {
	// "panels[0].actors[1].gesture", so the editor can highlight the field that produced it
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface StripCatalogAvatar {
	name: string;
	avatarID: number;
	type: AvatarData["type"];
	gestures: string[];
	// the intensities that reach distinct art on this character, probed on first read
	degrees: EmotionDegrees;
}

export interface StripCatalog {
	avatars: StripCatalogAvatar[];
	backgrounds: string[];
	emotions: readonly string[];
	gestures: string[];
	modes: readonly StripMode[];
	cameras: readonly StripCamera[];
	facings: readonly StripFacing[];
	sizes: readonly StripSize[];
	maxActors: number;
}

// emotion key paired with its wheel angle; neutral is the centre detente and has none
export function emotionAngles(): (readonly [string, number])[] {
	return EMOTION_KEYS.flatMap((key, index) => {
		const angle = EMOTION_ANGLES[index];
		return angle === undefined ? [] : [[key, angle] as const];
	});
}

export function buildCatalog(
	avatars: readonly AvatarData[],
	backgrounds: readonly string[],
): StripCatalog {
	const degreesOf = emotionDegreeCache(avatars, emotionAngles());
	return {
		avatars: avatars.map((data) => ({
			name: data.name,
			avatarID: data.avatarID,
			type: data.type,
			gestures: availableGestures(data),
			get degrees() {
				return degreesOf(data.name);
			},
		})),
		backgrounds: [...backgrounds],
		emotions: EMOTION_KEYS,
		gestures: [...GESTURE_EMOTIONS.keys()],
		modes: STRIP_MODES,
		cameras: STRIP_CAMERAS,
		facings: STRIP_FACINGS,
		sizes: STRIP_SIZES,
		maxActors: MAX_ACTORS,
	};
}

// wheel coordinates for a named emotion; neutral is the zero-intensity centre detente
export function emotionVector(
	key: string,
	intensity: number | undefined,
): { emotion: number; intensity: number } | null {
	const index = EMOTION_KEYS.indexOf(key.toLowerCase());
	if (index < 0) return null;
	if (index === EMOTION_KEYS.length - 1) return { emotion: 0, intensity: 0 };
	const angle = EMOTION_ANGLES[index];
	if (angle === undefined) return null;
	const strength = intensity ?? 1;
	return { emotion: angle, intensity: Math.min(1, Math.max(0, strength)) };
}

export function emptyStrip(): Strip {
	return { version: STRIP_VERSION, size: "modern", panels: [] };
}

export function emptyPanel(): StripPanel {
	return { camera: "wide", actors: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

interface ParseContext {
	issues: StripIssue[];
	avatarNames: Set<string>;
	gesturesByAvatar: Map<string, Set<string>>;
	backgrounds: Set<string>;
}

function fail(context: ParseContext, path: string, message: string): void {
	context.issues.push({ path, message, severity: "error" });
}

function warn(context: ParseContext, path: string, message: string): void {
	context.issues.push({ path, message, severity: "warning" });
}

function parseActor(
	raw: unknown,
	path: string,
	context: ParseContext,
): StripActor | null {
	if (!isRecord(raw)) {
		fail(context, path, "actor must be an object");
		return null;
	}
	const avatar = readString(raw.avatar)?.toLowerCase();
	if (!avatar) {
		fail(context, `${path}.avatar`, "avatar is required");
		return null;
	}
	if (!context.avatarNames.has(avatar)) {
		fail(context, `${path}.avatar`, `unknown avatar "${avatar}"`);
		return null;
	}
	const actor: StripActor = { avatar };

	const text = readString(raw.text);
	if (text !== undefined) actor.text = text;

	if (raw.mode !== undefined) {
		const mode = readString(raw.mode)?.toLowerCase();
		if (!mode || !(STRIP_MODES as readonly string[]).includes(mode))
			fail(context, `${path}.mode`, `unknown mode "${String(raw.mode)}"`);
		else actor.mode = mode as StripMode;
	}

	if (raw.emotion !== undefined) {
		const emotion = readString(raw.emotion)?.toLowerCase();
		if (!emotion || !EMOTION_KEYS.includes(emotion))
			fail(
				context,
				`${path}.emotion`,
				`unknown emotion "${String(raw.emotion)}"`,
			);
		else actor.emotion = emotion;
	}

	if (raw.intensity !== undefined) {
		const intensity = raw.intensity;
		if (typeof intensity !== "number" || !Number.isFinite(intensity))
			fail(context, `${path}.intensity`, "intensity must be a number");
		else if (intensity < 0 || intensity > 1)
			fail(context, `${path}.intensity`, "intensity must be between 0 and 1");
		else actor.intensity = intensity;
	}

	if (raw.gesture !== undefined && raw.gesture !== null && raw.gesture !== "") {
		const gesture = readString(raw.gesture)?.toLowerCase();
		if (!gesture || !GESTURE_EMOTIONS.has(gesture))
			fail(
				context,
				`${path}.gesture`,
				`unknown gesture "${String(raw.gesture)}"`,
			);
		else {
			actor.gesture = gesture;
			if (!context.gesturesByAvatar.get(avatar)?.has(gesture))
				warn(
					context,
					`${path}.gesture`,
					`${avatar} has no art for "${gesture}"; it will pose neutral`,
				);
		}
	}

	if (raw.facing !== undefined) {
		const facing = readString(raw.facing)?.toLowerCase();
		if (!facing || !(STRIP_FACINGS as readonly string[]).includes(facing))
			fail(context, `${path}.facing`, `unknown facing "${String(raw.facing)}"`);
		else actor.facing = facing as StripFacing;
	}

	return actor;
}

function parsePanel(
	raw: unknown,
	path: string,
	context: ParseContext,
): StripPanel | null {
	if (!isRecord(raw)) {
		fail(context, path, "panel must be an object");
		return null;
	}
	const panel: StripPanel = { actors: [] };

	if (raw.background !== undefined && raw.background !== null) {
		const background = readString(raw.background);
		if (background === undefined)
			fail(context, `${path}.background`, "background must be a string");
		else if (background !== "" && !context.backgrounds.has(background))
			fail(context, `${path}.background`, `unknown background "${background}"`);
		else panel.background = background;
	}

	if (raw.camera !== undefined) {
		const camera = readString(raw.camera)?.toLowerCase();
		if (!camera || !(STRIP_CAMERAS as readonly string[]).includes(camera))
			fail(context, `${path}.camera`, `unknown camera "${String(raw.camera)}"`);
		else panel.camera = camera as StripCamera;
	}

	if (raw.zoom !== undefined) {
		const zoom = raw.zoom;
		if (typeof zoom !== "number" || !Number.isFinite(zoom))
			fail(context, `${path}.zoom`, "zoom must be a number");
		else if (zoom < ZOOM_MIN || zoom > ZOOM_MAX)
			fail(
				context,
				`${path}.zoom`,
				`zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX}`,
			);
		else panel.zoom = zoom;
	}

	if (raw.border !== undefined) {
		if (typeof raw.border !== "boolean")
			fail(context, `${path}.border`, "border must be a boolean");
		else panel.border = raw.border;
	}

	if (!Array.isArray(raw.actors)) {
		fail(context, `${path}.actors`, "actors must be an array");
		return panel;
	}
	if (raw.actors.length > MAX_ACTORS)
		fail(
			context,
			`${path}.actors`,
			`a panel holds at most ${MAX_ACTORS} actors`,
		);

	let balloons = 0;
	raw.actors.slice(0, MAX_ACTORS).forEach((rawActor, index) => {
		const actor = parseActor(rawActor, `${path}.actors[${index}]`, context);
		if (!actor) return;
		if (actor.text) balloons++;
		panel.actors.push(actor);
	});
	if (balloons > MAX_BALLOONS)
		fail(
			context,
			`${path}.actors`,
			`a panel holds at most ${MAX_BALLOONS} balloons`,
		);
	return panel;
}

export interface ParseResult {
	strip: Strip;
	issues: StripIssue[];
}

export function parseStrip(raw: unknown, catalog: StripCatalog): ParseResult {
	const context: ParseContext = {
		issues: [],
		avatarNames: new Set(catalog.avatars.map((entry) => entry.name)),
		gesturesByAvatar: new Map(
			catalog.avatars.map((entry) => [entry.name, new Set(entry.gestures)]),
		),
		backgrounds: new Set(catalog.backgrounds),
	};
	const strip = emptyStrip();
	if (!isRecord(raw)) {
		fail(context, "", "strip must be a JSON object");
		return { strip, issues: context.issues };
	}
	if (raw.version !== undefined && raw.version !== STRIP_VERSION)
		warn(context, "version", `expected version ${STRIP_VERSION}`);

	if (raw.size !== undefined) {
		const size = readString(raw.size)?.toLowerCase();
		if (!size || !(STRIP_SIZES as readonly string[]).includes(size))
			fail(context, "size", `unknown size "${String(raw.size)}"`);
		else strip.size = size as StripSize;
	}

	if (raw.seed !== undefined) {
		if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed))
			fail(context, "seed", "seed must be an integer");
		else strip.seed = raw.seed;
	}

	if (raw.columns !== undefined) {
		const columns = raw.columns;
		if (
			typeof columns !== "number" ||
			!Number.isInteger(columns) ||
			columns < COLUMNS_MIN ||
			columns > COLUMNS_MAX
		)
			fail(
				context,
				"columns",
				`columns must be an integer from ${COLUMNS_MIN} to ${COLUMNS_MAX}`,
			);
		else strip.columns = columns;
	}

	if (!Array.isArray(raw.panels)) {
		fail(context, "panels", "panels must be an array");
		return { strip, issues: context.issues };
	}
	raw.panels.forEach((rawPanel, index) => {
		const panel = parsePanel(rawPanel, `panels[${index}]`, context);
		if (panel) strip.panels.push(panel);
	});
	return { strip, issues: context.issues };
}

export function parseStripJson(
	text: string,
	catalog: StripCatalog,
): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return {
			strip: emptyStrip(),
			issues: [
				{
					path: "",
					message: error instanceof Error ? error.message : "invalid JSON",
					severity: "error",
				},
			],
		};
	}
	return parseStrip(raw, catalog);
}

// drops defaulted fields so a hand-written script round-trips without acquiring noise
export function stripToJson(strip: Strip): string {
	const panels = strip.panels.map((panel) => ({
		...(panel.background ? { background: panel.background } : {}),
		...(panel.camera && panel.camera !== "wide"
			? { camera: panel.camera }
			: {}),
		...(panel.zoom !== undefined && panel.zoom !== 1
			? { zoom: panel.zoom }
			: {}),
		...(panel.border === false ? { border: false } : {}),
		actors: panel.actors.map((actor) => ({
			avatar: actor.avatar,
			...(actor.text ? { text: actor.text } : {}),
			...(actor.mode && actor.mode !== "say" ? { mode: actor.mode } : {}),
			...(actor.emotion && actor.emotion !== NEUTRAL_KEY
				? { emotion: actor.emotion }
				: {}),
			...(actor.intensity !== undefined && actor.intensity !== 1
				? { intensity: actor.intensity }
				: {}),
			...(actor.gesture ? { gesture: actor.gesture } : {}),
			...(actor.facing && actor.facing !== "right"
				? { facing: actor.facing }
				: {}),
		})),
	}));
	return `${JSON.stringify(
		{
			version: STRIP_VERSION,
			...(strip.size && strip.size !== "modern" ? { size: strip.size } : {}),
			...(strip.seed !== undefined ? { seed: strip.seed } : {}),
			...(strip.columns !== undefined && strip.columns !== COLUMNS_DEFAULT
				? { columns: strip.columns }
				: {}),
			panels,
		},
		null,
		"  ",
	)}\n`;
}
