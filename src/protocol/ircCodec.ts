// Authentic IRC annotation codec (protsupp.cpp:3028-3064): standalone; the WebSocket protocol does not use it.

import type { ChatMode, ComicAnnotation } from "./room.js";
import { CHAT_MODES } from "./room.js";

// numeric fields are one printable byte each, value + '0' (protsupp.cpp:994-1003)
const BASE = "0".charCodeAt(0);

function toByte(value: number): string {
	return String.fromCharCode(BASE + value);
}

function fromByte(char: string | undefined): number | null {
	if (char === undefined) return null;
	const value = char.charCodeAt(0) - BASE;
	return value >= 0 && value <= 255 ? value : null;
}

// wire intensity is (BYTE)(intensity * 10) truncation (avatario.cpp:78)
function toTenths(intensity: number): number {
	return Math.trunc(intensity * 10);
}

// (#G<t><te><ti>E<f><fe><fi>[R]M<m>[T<nicks>]) <text>, the non-IRCX inline framing (protsupp.cpp:3048-3067)
export function encodeIrcAnnotation(
	mode: ChatMode,
	annotation: ComicAnnotation,
	text: string,
): string {
	// strip characters that would break the framing
	const talkTos = annotation.talkTos
		.map((name) => name.replace(/[\s,()]/g, ""))
		.filter((name) => name.length > 0);
	const sections = [
		"#",
		"G",
		toByte(annotation.torsoIndex),
		toByte(annotation.torsoEmotionIndex),
		toByte(toTenths(annotation.torsoIntensity)),
		"E",
		toByte(annotation.faceIndex),
		toByte(annotation.faceEmotionIndex),
		toByte(toTenths(annotation.faceIntensity)),
		annotation.requested ? "R" : "",
		"M",
		toByte(mode),
		talkTos.length > 0 ? `T${talkTos.join(",")}` : "",
	].join("");
	return `(${sections}) ${text}`;
}

export function decodeIrcAnnotation(raw: string): {
	mode: ChatMode;
	annotation: ComicAnnotation;
	text: string;
} | null {
	// ProcessSay detects "(#" and the ") " closer (protsupp.cpp:1541,1576-1580)
	if (!raw.startsWith("(#")) return null;
	const close = raw.indexOf(") ", 2);
	if (close < 0) return null;
	const body = raw.slice(2, close);
	const text = raw.slice(close + 2);
	let at = 0;
	let torso: [number, number, number] | null = null;
	let face: [number, number, number] | null = null;
	let requested = false;
	let mode: number | null = null;
	let talkTos: string[] = [];
	const triple = (): [number, number, number] | null => {
		const a = fromByte(body[at]);
		const b = fromByte(body[at + 1]);
		const c = fromByte(body[at + 2]);
		if (a === null || b === null || c === null) return null;
		at += 3;
		return [a, b, c];
	};
	while (at < body.length) {
		const section = body[at++];
		if (section === "G") {
			torso = triple();
			if (!torso) return null;
		} else if (section === "E") {
			face = triple();
			if (!face) return null;
		} else if (section === "R") {
			requested = true;
		} else if (section === "M") {
			mode = fromByte(body[at++]);
			if (mode === null) return null;
		} else if (section === "T") {
			// T runs to the closing paren (protsupp.cpp:1497-1507)
			talkTos = body
				.slice(at)
				.split(",")
				.filter((nick) => nick.length > 0);
			at = body.length;
		} else {
			return null;
		}
	}
	if (!torso || !face || mode === null) return null;
	if (!(CHAT_MODES as readonly number[]).includes(mode)) return null;
	return {
		mode: mode as ChatMode,
		annotation: {
			faceIndex: face[0],
			faceEmotionIndex: face[1],
			faceIntensity: face[2] / 10,
			torsoIndex: torso[0],
			torsoEmotionIndex: torso[1],
			torsoIntensity: torso[2] / 10,
			requested,
			talkTos,
		},
		text,
	};
}
