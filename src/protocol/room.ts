// Wire protocol shared by the room Durable Object and the browser client.

export const MAX_NAME_LENGTH = 24;
export const MAX_TEXT_LENGTH = 1000;
export const CAST_SIZE = 22;
export const ROOM_MODES = [1, 2, 3, 5] as const;
// welcome carries the newest chunk; older chunks arrive via history requests
export const HISTORY_CHUNK = 50;
// stream entry whose text is a backdrop name, replayed so every client recomposes identically
export const BACKGROUND_MODE = 6;
// IDS_DEFAULT_BACKDROP (chat.rc:2327)
export const DEFAULT_BACKGROUND = "field";

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
	| { type: "join"; name: string; avatar: number }
	| { type: "chat"; text: string; mode: number; pose?: PoseIndices }
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
	| { type: "error"; reason: string };

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
		return { type: "join", name, avatar };
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
		return pose
			? { type: "chat", text, mode, pose }
			: { type: "chat", text, mode };
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
