// Wire protocol shared by the room Durable Object and the browser client.

export const MAX_NAME_LENGTH = 24;
export const MAX_TEXT_LENGTH = 1000;
export const CAST_SIZE = 6;
export const ROOM_MODES = [1, 2, 3, 5] as const;

export interface ChatEntry {
	seq: number;
	avatar: number;
	name: string;
	text: string;
	mode: number;
}

export interface RosterEntry {
	name: string;
	avatar: number;
}

export type ClientMessage =
	| { type: "join"; name: string; avatar: number }
	| { type: "chat"; text: string; mode: number };

export type ServerMessage =
	| {
			type: "welcome";
			avatar: number;
			roster: RosterEntry[];
			history: ChatEntry[];
	  }
	| { type: "chat"; entry: ChatEntry }
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
		return { type: "chat", text, mode };
	}
	return null;
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
