// IRC-style /gesture commands: the only way to reach pose art coded above the emotion ring, which the wheel and the chat.rc rules both skip.

import type { AvatarData } from "../engine/avatar.js";
import { toLowerAscii } from "../engine/ctype.js";
import {
	EM_3QFWALK,
	EM_3QRWALK,
	EM_DOUBLEPOINT,
	EM_POINTOTHER,
	EM_POINTSELF,
	EM_SHRUG,
	EM_SIDEWALK,
	EM_WAVE,
} from "../engine/emotion.js";

const GESTURE_EMOTIONS = new Map<string, number>([
	["wave", EM_WAVE],
	["point", EM_POINTOTHER],
	["pointself", EM_POINTSELF],
	["doublepoint", EM_DOUBLEPOINT],
	["shrug", EM_SHRUG],
	["walkaway", EM_3QRWALK],
	["walk", EM_SIDEWALK],
	["walkup", EM_3QFWALK],
]);

export interface Gesture {
	command: string;
	emotion: number;
	text: string;
}

// a leading /word claims the line; the rest is what still goes in the balloon
export function parseGesture(input: string): Gesture | null {
	const match = /^\s*\/([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(input);
	if (!match?.[1]) return null;
	const command = toLowerAscii(match[1]);
	const emotion = GESTURE_EMOTIONS.get(command);
	if (emotion === undefined) return null;
	return { command, emotion, text: (match[2] ?? "").trim() };
}

export function hasGesture(data: AvatarData, emotion: number): boolean {
	return (
		data.torsos.some((torso) => torso.emotion === emotion) ||
		data.bodies.some((body) => body.emotion === emotion)
	);
}

// the slash has to survive the round trip or parseGesture stops seeing a command
export function gestureInsert(command: string): string {
	return `/${command} `;
}

// completion only offers gestures this avatar's art can actually strike
export function availableGestures(data: AvatarData | undefined): string[] {
	if (!data) return [];
	return [...GESTURE_EMOTIONS]
		.filter(([, emotion]) => hasGesture(data, emotion))
		.map(([command]) => command);
}
