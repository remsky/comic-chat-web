// Wire protocol shared by the room Durable Object and the browser client.

import { CAST_BOUNDS } from "./castBounds.js";

export const MAX_NAME_LENGTH = 24;
export const MAX_TEXT_LENGTH = 1000;
export const CAST_SIZE = 31;
// room names share one charset across the websocket route, the allowlist, and the join field
export const ROOM_NAME_PATTERN = /^[\w-]{1,64}$/;
// the bounded default room set for a demo deploy; override with the worker ROOMS var
export const DEFAULT_ROOMS = [
	"lobby",
	"pen-pals",
	"dial-up",
	"crack-a-joke",
] as const;
// SM_SAY/SM_WHISPER/SM_THINK/SM_ACTION (defines.h:57-61); SM_SHOUT=4 exists but nothing emits it (protsupp.cpp:1022-1034)
export const CHAT_MODES = [1, 2, 3, 5] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
// welcome carries the newest chunk; older chunks arrive via history requests
export const HISTORY_CHUNK = 50;
// IDS_DEFAULT_BACKDROP (chat.rc:2327)
export const DEFAULT_BACKGROUND = "field";
export const BACKGROUND_NAME_PATTERN = /^[\w-]{1,32}$/;
// emFloats has entries 0..17 (avatario.cpp:45-64); 9 is EM_NEUTRAL, the encoder's default
export const EMOTION_INDEX_MAX = 17;
export const NEUTRAL_EMOTION_INDEX = 9;
// GetAddressees clips the wire list to the first five nicks (protsupp.cpp:2980)
export const MAX_TALK_TOS = 5;
// error reason shared so the client can tell a dropped message from a fatal rejection
export const RATE_LIMIT_REASON = "message rate limit exceeded";
// content-filter rejection; the client shows a countdown from the error's retryAfter
export const MESSAGE_BLOCKED_REASON = "message blocked";
// join rejection; the client surfaces it at the nickname field
export const NAME_BLOCKED_REASON = "name blocked";

// Sender-resolved G/E/R/M/T annotation: G is the torso triple, E the face triple (protsupp.cpp:3048-3064)
export interface ComicAnnotation {
	// record offsets from GetIndices (avatar.cpp:768-782); a simple avatar's body rides torsoIndex with faceIndex 0
	faceIndex: number;
	// the selected record's own metadata from GetEmotions (avatar.cpp:802-817), kept so remapped art can match by emotion (histent.cpp:94-106)
	faceEmotionIndex: number;
	// normalized 0..1, quantized to tenths because the wire carries (BYTE)(intensity * 10) (avatario.cpp:78)
	faceIntensity: number;
	torsoIndex: number;
	torsoEmotionIndex: number;
	// a simple avatar sends torso emotion/intensity 0 and its body emotion in the face slots (avatar.cpp:776-817)
	torsoIntensity: number;
	// bare R flag, emitted when m_freeze != AF_UNFROZEN (protsupp.cpp:3052, avatar.cpp:773)
	requested: boolean;
	talkTos: string[];
}

export interface ChatEntry {
	type: "chat";
	seq: number;
	avatar: number;
	name: string;
	text: string;
	mode: ChatMode;
	annotation: ComicAnnotation;
}

// original backdrops were a "# BDrop" channel command, not a send mode (protsupp.cpp:3403-3419)
export interface BackgroundEntry {
	type: "background";
	seq: number;
	name: string;
	by: string;
}

export const ANNOUNCE_KINDS = ["nick", "avatar", "depart", "arrive"] as const;
export type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];

// system events in the replay stream; detail carries the new nick, avatar id, or other room
export interface AnnouncementEntry {
	type: "announce";
	kind: AnnounceKind;
	seq: number;
	avatar: number;
	name: string;
	detail: string;
}

export type RoomEntry = ChatEntry | BackgroundEntry | AnnouncementEntry;

export interface RosterEntry {
	name: string;
	avatar: number;
}

// one row of GET /api/rooms, the web stand-in for the IRC LIST-backed Chat Room List dialog
export interface RoomListing {
	name: string;
	members: number;
	active: number;
}

export type ClientMessage =
	| { type: "join"; name: string; avatar: number; from?: string; sent?: number }
	| {
			type: "chat";
			text: string;
			mode: ChatMode;
			annotation: ComicAnnotation;
			sent?: number;
	  }
	| { type: "history"; before: number }
	| { type: "background"; name: string }
	| { type: "profile"; name: string; avatar: number }
	| { type: "depart"; to: string };

export type ServerMessage =
	| {
			type: "welcome";
			avatar: number;
			background: string;
			// backdrop in effect just before history[0], so replay starts where the room was
			historyBackground: string;
			roster: RosterEntry[];
			history: RoomEntry[];
	  }
	| { type: "entry"; entry: RoomEntry }
	| { type: "history"; entries: RoomEntry[]; background: string }
	| { type: "joined"; who: RosterEntry }
	| { type: "left"; who: RosterEntry }
	| { type: "profile"; was: RosterEntry; who: RosterEntry }
	| { type: "error"; reason: string; retryAfter?: number };

function uchar(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= 0 && value <= 255 ? value : null;
}

function emotionIndex(value: unknown): number | null {
	const index = uchar(value);
	return index !== null && index <= EMOTION_INDEX_MAX ? index : null;
}

// normalized 0..1 and exactly representable as tenths, so storage/IRC quantization is lossless
function tenthsIntensity(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const tenths = Math.round(value * 10);
	if (tenths < 0 || tenths > 10 || value !== tenths / 10) return null;
	return value;
}

function talkToList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_TALK_TOS) return null;
	const seen = new Set<string>();
	const nicks: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") return null;
		const nick = item.trim();
		if (nick.length === 0 || nick.length > MAX_NAME_LENGTH) return null;
		const key = nick.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		nicks.push(nick);
	}
	return nicks;
}

export function parseAnnotation(raw: unknown): ComicAnnotation | null {
	if (typeof raw !== "object" || raw === null) return null;
	const annotation = raw as Record<string, unknown>;
	const faceIndex = uchar(annotation.faceIndex);
	const faceEmotionIndex = emotionIndex(annotation.faceEmotionIndex);
	const faceIntensity = tenthsIntensity(annotation.faceIntensity);
	const torsoIndex = uchar(annotation.torsoIndex);
	const torsoEmotionIndex = emotionIndex(annotation.torsoEmotionIndex);
	const torsoIntensity = tenthsIntensity(annotation.torsoIntensity);
	const talkTos = talkToList(annotation.talkTos);
	if (
		faceIndex === null ||
		faceEmotionIndex === null ||
		faceIntensity === null ||
		torsoIndex === null ||
		torsoEmotionIndex === null ||
		torsoIntensity === null ||
		typeof annotation.requested !== "boolean" ||
		talkTos === null
	)
		return null;
	return {
		faceIndex,
		faceEmotionIndex,
		faceIntensity,
		torsoIndex,
		torsoEmotionIndex,
		torsoIntensity,
		requested: annotation.requested,
		talkTos,
	};
}

// record bounds for the sender's assigned avatar; simple avatars accept only the documented shape
export function annotationInBounds(
	annotation: ComicAnnotation,
	avatar: number,
): boolean {
	const bounds = CAST_BOUNDS[avatar - 1];
	if (!bounds) return false;
	if (bounds.type === "simple")
		return (
			annotation.faceIndex === 0 &&
			annotation.torsoIndex < bounds.bodies &&
			annotation.torsoEmotionIndex === 0 &&
			annotation.torsoIntensity === 0
		);
	return (
		annotation.faceIndex < bounds.faces && annotation.torsoIndex < bounds.torsos
	);
}

function chatMode(value: unknown): ChatMode | null {
	if (typeof value !== "number") return null;
	const mode = Math.trunc(value);
	return (CHAT_MODES as readonly number[]).includes(mode)
		? (mode as ChatMode)
		: null;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
	if (typeof raw !== "string") return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const message = data as Record<string, unknown>;
	if (message.type === "join" || message.type === "profile") {
		if (typeof message.name !== "string" || typeof message.avatar !== "number")
			return null;
		const name = message.name.trim().slice(0, MAX_NAME_LENGTH);
		if (name.length === 0) return null;
		const avatar = Math.trunc(message.avatar);
		if (avatar < 1 || avatar > CAST_SIZE) return null;
		if (message.type === "profile") return { type: "profile", name, avatar };
		// like sent, a malformed origin room is dropped rather than fatal
		const from =
			typeof message.from === "string" && ROOM_NAME_PATTERN.test(message.from)
				? message.from
				: undefined;
		const sent = sentStamp(message.sent);
		return {
			type: "join",
			name,
			avatar,
			...(from !== undefined ? { from } : {}),
			...(sent !== undefined ? { sent } : {}),
		};
	}
	if (message.type === "depart") {
		if (typeof message.to !== "string" || !ROOM_NAME_PATTERN.test(message.to))
			return null;
		return { type: "depart", to: message.to };
	}
	if (message.type === "chat") {
		if (typeof message.text !== "string") return null;
		const text = message.text.slice(0, MAX_TEXT_LENGTH);
		if (text.trim().length === 0) return null;
		const mode = chatMode(message.mode);
		if (mode === null) return null;
		// a stale pre-annotation page should fail loudly, not create partial history
		if ("pose" in message) return null;
		const annotation = parseAnnotation(message.annotation);
		if (annotation === null) return null;
		const sent = sentStamp(message.sent);
		return {
			type: "chat",
			text,
			mode,
			annotation,
			...(sent !== undefined ? { sent } : {}),
		};
	}
	if (message.type === "history") {
		if (typeof message.before !== "number" || !Number.isFinite(message.before))
			return null;
		const before = Math.trunc(message.before);
		if (before < 1) return null;
		return { type: "history", before };
	}
	if (message.type === "background") {
		if (typeof message.name !== "string") return null;
		if (message.name !== "" && !BACKGROUND_NAME_PATTERN.test(message.name))
			return null;
		return { type: "background", name: message.name };
	}
	return null;
}

// the sender's clock stamp on joins and chats; malformed stamps are dropped, not fatal
function sentStamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 1
		? Math.trunc(value)
		: undefined;
}

function seqNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
		return null;
	return value;
}

function boundedString(value: unknown, max: number): string | null {
	return typeof value === "string" && value.length <= max ? value : null;
}

export function parseRoomEntry(raw: unknown): RoomEntry | null {
	if (typeof raw !== "object" || raw === null) return null;
	const entry = raw as Record<string, unknown>;
	const seq = seqNumber(entry.seq);
	if (seq === null) return null;
	if (entry.type === "background") {
		const name = boundedString(entry.name, 32);
		const by = boundedString(entry.by, MAX_NAME_LENGTH);
		if (name === null || by === null) return null;
		if (name !== "" && !BACKGROUND_NAME_PATTERN.test(name)) return null;
		return { type: "background", seq, name, by };
	}
	const avatar =
		typeof entry.avatar === "number" &&
		Number.isInteger(entry.avatar) &&
		entry.avatar >= 1 &&
		entry.avatar <= CAST_SIZE
			? entry.avatar
			: null;
	const name = boundedString(entry.name, MAX_NAME_LENGTH);
	if (avatar === null || name === null) return null;
	if (entry.type === "announce") {
		if (
			typeof entry.kind !== "string" ||
			!(ANNOUNCE_KINDS as readonly string[]).includes(entry.kind)
		)
			return null;
		const detail = boundedString(entry.detail, MAX_TEXT_LENGTH);
		if (detail === null) return null;
		return {
			type: "announce",
			kind: entry.kind as AnnounceKind,
			seq,
			avatar,
			name,
			detail,
		};
	}
	if (entry.type === "chat") {
		const text = boundedString(entry.text, MAX_TEXT_LENGTH);
		const mode = chatMode(entry.mode);
		const annotation = parseAnnotation(entry.annotation);
		if (text === null || text.length === 0 || mode === null || !annotation)
			return null;
		return { type: "chat", seq, avatar, name, text, mode, annotation };
	}
	return null;
}

function rosterEntry(raw: unknown): RosterEntry | null {
	if (typeof raw !== "object" || raw === null) return null;
	const entry = raw as Record<string, unknown>;
	const name = boundedString(entry.name, MAX_NAME_LENGTH);
	if (
		name === null ||
		typeof entry.avatar !== "number" ||
		!Number.isInteger(entry.avatar)
	)
		return null;
	return { name, avatar: entry.avatar };
}

function entryList(raw: unknown): RoomEntry[] | null {
	if (!Array.isArray(raw)) return null;
	const entries: RoomEntry[] = [];
	for (const item of raw) {
		const entry = parseRoomEntry(item);
		if (!entry) return null;
		entries.push(entry);
	}
	return entries;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
	if (typeof raw !== "string") return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const message = data as Record<string, unknown>;
	if (message.type === "welcome") {
		const roster = Array.isArray(message.roster)
			? message.roster.map(rosterEntry)
			: null;
		const history = entryList(message.history);
		if (
			typeof message.avatar !== "number" ||
			typeof message.background !== "string" ||
			typeof message.historyBackground !== "string" ||
			roster === null ||
			roster.some((entry) => entry === null) ||
			history === null
		)
			return null;
		return {
			type: "welcome",
			avatar: message.avatar,
			background: message.background,
			historyBackground: message.historyBackground,
			roster: roster as RosterEntry[],
			history,
		};
	}
	if (message.type === "entry") {
		const entry = parseRoomEntry(message.entry);
		return entry ? { type: "entry", entry } : null;
	}
	if (message.type === "history") {
		const entries = entryList(message.entries);
		if (entries === null || typeof message.background !== "string") return null;
		return { type: "history", entries, background: message.background };
	}
	if (
		message.type === "joined" ||
		message.type === "left" ||
		message.type === "profile"
	) {
		const who = rosterEntry(message.who);
		if (!who) return null;
		if (message.type === "profile") {
			const was = rosterEntry(message.was);
			return was ? { type: "profile", was, who } : null;
		}
		return { type: message.type, who };
	}
	if (message.type === "error") {
		if (typeof message.reason !== "string") return null;
		return {
			type: "error",
			reason: message.reason,
			...(typeof message.retryAfter === "number"
				? { retryAfter: message.retryAfter }
				: {}),
		};
	}
	return null;
}

// GET /api/rooms body; null on any shape mismatch (static hosting answers this path with HTML)
export function parseRoomListings(raw: unknown): RoomListing[] | null {
	if (typeof raw !== "object" || raw === null) return null;
	const rooms = (raw as Record<string, unknown>).rooms;
	if (!Array.isArray(rooms)) return null;
	const listings: RoomListing[] = [];
	for (const item of rooms) {
		if (typeof item !== "object" || item === null) return null;
		const listing = item as Record<string, unknown>;
		if (
			typeof listing.name !== "string" ||
			typeof listing.members !== "number" ||
			typeof listing.active !== "number"
		)
			return null;
		listings.push({
			name: listing.name,
			members: listing.members,
			active: listing.active,
		});
	}
	return listings;
}

export function roomNameFromPath(pathname: string): string | null {
	const match = /^\/api\/rooms\/([\w-]{1,64})\/websocket$/.exec(pathname);
	return match?.[1] ?? null;
}

// The one aggregate bound on a deploy: only these rooms spin up a DO. Reads the ROOMS var (array or comma/space string), validates and de-dupes, falls back to DEFAULT_ROOMS so a room always exists.
export function resolveRoomAllowlist(value: unknown): string[] {
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/[\s,]+/)
			: [];
	const names = new Set<string>();
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const name = item.trim();
		if (ROOM_NAME_PATTERN.test(name)) names.add(name);
	}
	return names.size > 0 ? [...names] : [...DEFAULT_ROOMS];
}

export function pickAvatar(
	requested: number,
	taken: readonly number[],
): number | null {
	if (!taken.includes(requested)) return requested;
	for (let avatar = 1; avatar <= CAST_SIZE; avatar++) {
		if (!taken.includes(avatar)) return avatar;
	}
	return null;
}
