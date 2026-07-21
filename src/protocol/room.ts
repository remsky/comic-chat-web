// Wire protocol shared by the room Durable Object and the browser client.

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
export const ROOM_MODES = [1, 2, 3, 5] as const;
// welcome carries the newest chunk; older chunks arrive via history requests
export const HISTORY_CHUNK = 50;
// stream entry whose text is a backdrop name, replayed so every client recomposes identically
export const BACKGROUND_MODE = 6;
// IDS_DEFAULT_BACKDROP (chat.rc:2327)
export const DEFAULT_BACKGROUND = "field";
// error reason shared so the client can tell a dropped message from a fatal rejection
export const RATE_LIMIT_REASON = "message rate limit exceeded";
// content-filter rejection; the client shows a countdown from the error's retryAfter
export const MESSAGE_BLOCKED_REASON = "message blocked";

// SayEntry's m_expr/m_gest/m_req pose triple (histent.cpp:44-50), sent with each line
export interface PoseIndices {
	expr: number;
	gest: number;
	req: number;
}

export interface ChatEntry {
	seq: number;
	avatar: number;
	name: string;
	text: string;
	mode: number;
	pose?: PoseIndices;
}

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
	| { type: "join"; name: string; avatar: number; sent?: number }
	| {
			type: "chat";
			text: string;
			mode: number;
			pose?: PoseIndices;
			sent?: number;
	  }
	| { type: "history"; before: number }
	| { type: "background"; name: string };

export type ServerMessage =
	| {
			type: "welcome";
			avatar: number;
			background: string;
			roster: RosterEntry[];
			history: ChatEntry[];
	  }
	| { type: "chat"; entry: ChatEntry }
	| { type: "history"; entries: ChatEntry[] }
	| { type: "joined"; who: RosterEntry }
	| { type: "left"; who: RosterEntry }
	| { type: "error"; reason: string; retryAfter?: number };

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
	if (message.type === "join") {
		if (typeof message.name !== "string" || typeof message.avatar !== "number")
			return null;
		const name = message.name.trim().slice(0, MAX_NAME_LENGTH);
		if (name.length === 0) return null;
		const avatar = Math.trunc(message.avatar);
		if (avatar < 1 || avatar > CAST_SIZE) return null;
		const sent = sentStamp(message.sent);
		return sent === undefined
			? { type: "join", name, avatar }
			: { type: "join", name, avatar, sent };
	}
	if (message.type === "chat") {
		if (typeof message.text !== "string" || typeof message.mode !== "number")
			return null;
		const text = message.text.slice(0, MAX_TEXT_LENGTH);
		if (text.trim().length === 0) return null;
		const mode = Math.trunc(message.mode);
		if (!(ROOM_MODES as readonly number[]).includes(mode)) return null;
		const pose = parsePose(message.pose);
		if (pose === null) return null;
		const sent = sentStamp(message.sent);
		return {
			type: "chat",
			text,
			mode,
			...(pose ? { pose } : {}),
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
		if (message.name !== "" && !/^[\w-]{1,32}$/.test(message.name)) return null;
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

function uchar(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= 0 && value <= 255 ? value : null;
}

// GetIndices/SetIndices exchange UCHARs (avatar.cpp:825-857); null means malformed
function parsePose(raw: unknown): PoseIndices | null | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "object" || raw === null) return null;
	const pose = raw as Record<string, unknown>;
	const expr = uchar(pose.expr);
	const gest = uchar(pose.gest);
	const req = uchar(pose.req);
	if (expr === null || gest === null || req === null || req > 1) return null;
	return { expr, gest, req };
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
	if (typeof raw !== "string") return null;
	try {
		const data = JSON.parse(raw) as ServerMessage;
		return typeof data === "object" && data !== null && "type" in data
			? data
			: null;
	} catch {
		return null;
	}
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
