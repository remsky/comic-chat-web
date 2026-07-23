// One Durable Object per chat room: WebSocket hibernation, SQLite history, cast seat assignment.

import { DurableObject } from "cloudflare:workers";
import {
	type AnnounceKind,
	annotationInBounds,
	type ChatMode,
	type ComicAnnotation,
	DEFAULT_BACKGROUND,
	HISTORY_CHUNK,
	MESSAGE_BLOCKED_REASON,
	NAME_BLOCKED_REASON,
	NEUTRAL_EMOTION_INDEX,
	parseClientMessage,
	pickAvatar,
	RATE_LIMIT_REASON,
	type RoomEntry,
	type RosterEntry,
	roomNameFromPath,
	type ServerMessage,
} from "../src/protocol/room.js";
import { isProhibited } from "./moderation.js";

// server policy: bound per-room storage, connections, and per-socket send rate
const HISTORY_RETENTION = 500;
const SOCKET_LIMIT = 12;
const RATE_BURST = 5;
const RATE_REFILL_MS = 1000;
// a rate-limited message is dropped with an error; only this many consecutive drops closes the socket
const FLOOD_CLOSE_STRIKES = 20;
// each blocked message mutes the socket for strikes * this, so repeat offenders wait longer
const MUTE_STEP_MS = 15_000;
// after this many blocked messages the socket is closed rather than muted again
const MOD_CLOSE_STRIKES = 5;
// keep the directory's last-active fresh for idle-but-chatty rooms without a report per message
const PRESENCE_REFRESH_MS = 5 * 60 * 1000;
// a chat composed this long ago is a dead pipe's TCP flush, not a late delivery; measured on the sender's own clock
const STALE_SEND_MS = 5_000;

interface SocketSeat {
	name: string;
	avatar: number;
}

interface SocketState {
	name?: string;
	avatar?: number;
	tokens?: number;
	at?: number;
	strikes?: number;
	modStrikes?: number;
	mutedUntil?: number;
	skew?: number;
}

// type alias, not interface: sql.exec's Record constraint needs the implicit index signature
type EventRow = {
	seq: number;
	event_type: string;
	avatar: number | null;
	name: string;
	text: string | null;
	mode: number | null;
	face_index: number | null;
	face_emotion_index: number | null;
	face_intensity_tenths: number | null;
	torso_index: number | null;
	torso_emotion_index: number | null;
	torso_intensity_tenths: number | null;
	requested: number | null;
	talk_tos_json: string | null;
	background_name: string | null;
	bg: string | null;
};

const EVENT_COLUMNS =
	"seq, event_type, avatar, name, text, mode, face_index, face_emotion_index, face_intensity_tenths, torso_index, torso_emotion_index, torso_intensity_tenths, requested, talk_tos_json, background_name, bg";

// strict read-back; a malformed stored list drops to no addressees rather than crashing replay
function talkTosFromJson(raw: string | null): string[] {
	if (raw === null) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function entryFromRow(row: EventRow): RoomEntry | null {
	if (row.event_type === "background")
		return {
			type: "background",
			seq: row.seq,
			name: row.background_name ?? "",
			by: row.name,
		};
	if (row.avatar === null) return null;
	if (row.event_type === "chat") {
		if (
			row.text === null ||
			row.mode === null ||
			row.face_index === null ||
			row.face_emotion_index === null ||
			row.face_intensity_tenths === null ||
			row.torso_index === null ||
			row.torso_emotion_index === null ||
			row.torso_intensity_tenths === null ||
			row.requested === null
		)
			return null;
		return {
			type: "chat",
			seq: row.seq,
			avatar: row.avatar,
			name: row.name,
			text: row.text,
			mode: row.mode as ChatMode,
			annotation: {
				faceIndex: row.face_index,
				faceEmotionIndex: row.face_emotion_index,
				faceIntensity: row.face_intensity_tenths / 10,
				torsoIndex: row.torso_index,
				torsoEmotionIndex: row.torso_emotion_index,
				torsoIntensity: row.torso_intensity_tenths / 10,
				requested: row.requested !== 0,
				talkTos: talkTosFromJson(row.talk_tos_json),
			},
		};
	}
	return {
		type: "announce",
		kind: row.event_type as AnnounceKind,
		seq: row.seq,
		avatar: row.avatar,
		name: row.name,
		detail: row.text ?? "",
	};
}

type LegacyMessageRow = {
	seq: number;
	avatar: number;
	name: string;
	text: string;
	mode: number;
	at: number;
	expr: number | null;
	gest: number | null;
	req: number | null;
	bg: string | null;
};

const LEGACY_BACKGROUND_MODE = 6;
const LEGACY_ANNOUNCE_KINDS: Record<number, AnnounceKind> = {
	7: "nick",
	8: "avatar",
	9: "depart",
	10: "arrive",
};

// poses copy over verbatim; emotion metadata was never stored, so chat rows read as neutral
function eventFromLegacyRow(row: LegacyMessageRow): EventRow & { at: number } {
	const event: EventRow & { at: number } = {
		seq: row.seq,
		event_type: "chat",
		avatar: row.avatar,
		name: row.name,
		text: row.text,
		mode: null,
		face_index: null,
		face_emotion_index: null,
		face_intensity_tenths: null,
		torso_index: null,
		torso_emotion_index: null,
		torso_intensity_tenths: null,
		requested: null,
		talk_tos_json: null,
		background_name: null,
		bg: row.bg ?? DEFAULT_BACKGROUND,
		at: row.at,
	};
	const announce = LEGACY_ANNOUNCE_KINDS[row.mode];
	if (row.mode === LEGACY_BACKGROUND_MODE) {
		event.event_type = "background";
		event.background_name = row.text;
		event.text = null;
	} else if (announce !== undefined) {
		event.event_type = announce;
	} else {
		event.mode = row.mode;
		event.face_index = row.expr ?? 0;
		event.face_emotion_index = NEUTRAL_EMOTION_INDEX;
		event.face_intensity_tenths = 0;
		event.torso_index = row.gest ?? 0;
		event.torso_emotion_index = 0;
		event.torso_intensity_tenths = 0;
		event.requested = row.req ? 1 : 0;
		event.talk_tos_json = "[]";
	}
	return event;
}

export class ChatRoomDO extends DurableObject<Env> {
	// ctx.id.name is unavailable after a hibernation wake, so the name is persisted on connect
	private roomName: string | null = null;
	private reportedAt = 0;
	// mirrors the stored background so tagging each insert costs no storage read
	private background = DEFAULT_BACKGROUND;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// answer client liveness pings in the runtime without waking the hibernated DO
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS events (
					seq INTEGER PRIMARY KEY AUTOINCREMENT,
					event_type TEXT NOT NULL,
					avatar INTEGER,
					name TEXT NOT NULL,
					text TEXT,
					mode INTEGER,
					face_index INTEGER,
					face_emotion_index INTEGER,
					face_intensity_tenths INTEGER,
					torso_index INTEGER,
					torso_emotion_index INTEGER,
					torso_intensity_tenths INTEGER,
					requested INTEGER,
					talk_tos_json TEXT,
					background_name TEXT,
					at INTEGER NOT NULL,
					bg TEXT NOT NULL
				)
			`);
			this.migrateLegacyMessages();
			this.background =
				(await this.ctx.storage.get<string>("background")) ??
				DEFAULT_BACKGROUND;
		});
	}

	// legacy messages rows keep their expr/gest/req poses; modes 6-10 become announce events
	private migrateLegacyMessages(): void {
		const sql = this.ctx.storage.sql;
		const legacy = sql
			.exec<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'",
			)
			.toArray();
		if (legacy.length === 0) return;
		if (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n > 0)
			return;
		const fields = `${EVENT_COLUMNS}, at`.split(", ") as (
			| keyof EventRow
			| "at"
		)[];
		const insert = `INSERT INTO events (${EVENT_COLUMNS}, at) VALUES (${fields.map(() => "?").join(", ")})`;
		this.ctx.storage.transactionSync(() => {
			// SELECT * tolerates ancient rooms that predate the pose and bg columns
			const rows = sql
				.exec<LegacyMessageRow>("SELECT * FROM messages ORDER BY seq")
				.toArray();
			for (const row of rows) {
				const event = eventFromLegacyRow(row);
				sql.exec(insert, ...fields.map((field) => event[field]));
			}
			sql.exec("DROP TABLE messages");
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket")
			return new Response("expected a websocket upgrade", { status: 426 });
		if (this.ctx.getWebSockets().length >= SOCKET_LIMIT)
			return new Response("room is at its connection limit", { status: 503 });
		const name = roomNameFromPath(new URL(request.url).pathname);
		if (name && name !== this.roomName) {
			this.roomName = name;
			await this.ctx.storage.put("room-name", name);
		}
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].serializeAttachment({ tokens: RATE_BURST, at: Date.now() });
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	private stateOf(ws: WebSocket): SocketState {
		const attachment = ws.deserializeAttachment() as unknown;
		if (typeof attachment !== "object" || attachment === null) return {};
		const state = attachment as Record<string, unknown>;
		return {
			...(typeof state.name === "string" ? { name: state.name } : {}),
			...(typeof state.avatar === "number" ? { avatar: state.avatar } : {}),
			...(typeof state.tokens === "number" ? { tokens: state.tokens } : {}),
			...(typeof state.at === "number" ? { at: state.at } : {}),
			...(typeof state.strikes === "number" ? { strikes: state.strikes } : {}),
			...(typeof state.modStrikes === "number"
				? { modStrikes: state.modStrikes }
				: {}),
			...(typeof state.mutedUntil === "number"
				? { mutedUntil: state.mutedUntil }
				: {}),
			...(typeof state.skew === "number" ? { skew: state.skew } : {}),
		};
	}

	// records a blocked message: escalates the mute, closes the socket past the strike ceiling
	private penalize(ws: WebSocket): void {
		const state = this.stateOf(ws);
		const modStrikes = (state.modStrikes ?? 0) + 1;
		if (modStrikes >= MOD_CLOSE_STRIKES) {
			ws.serializeAttachment({ ...state, modStrikes });
			ws.close(1008, MESSAGE_BLOCKED_REASON);
			return;
		}
		const muteMs = modStrikes * MUTE_STEP_MS;
		ws.serializeAttachment({
			...state,
			modStrikes,
			mutedUntil: Date.now() + muteMs,
		});
		this.send(ws, {
			type: "error",
			reason: MESSAGE_BLOCKED_REASON,
			retryAfter: muteMs,
		});
	}

	private seatOf(ws: WebSocket): SocketSeat | null {
		const state = this.stateOf(ws);
		return state.name !== undefined && state.avatar !== undefined
			? { name: state.name, avatar: state.avatar }
			: null;
	}

	private takeRateToken(ws: WebSocket): boolean {
		const state = this.stateOf(ws);
		const now = Date.now();
		const elapsed = Math.max(0, now - (state.at ?? now));
		const tokens = Math.min(
			RATE_BURST,
			(state.tokens ?? RATE_BURST) + elapsed / RATE_REFILL_MS,
		);
		const allowed = tokens >= 1;
		ws.serializeAttachment({
			...state,
			tokens: allowed ? tokens - 1 : tokens,
			at: now,
			strikes: allowed ? 0 : (state.strikes ?? 0) + 1,
		});
		return allowed;
	}

	private roster(): RosterEntry[] {
		const seats: RosterEntry[] = [];
		for (const ws of this.ctx.getWebSockets()) {
			const seat = this.seatOf(ws);
			if (seat) seats.push({ name: seat.name, avatar: seat.avatar });
		}
		return seats;
	}

	// the connect screen's room directory; tolerated as best-effort so chat never depends on it
	private async reportPresence(): Promise<void> {
		this.roomName ??= (await this.ctx.storage.get<string>("room-name")) ?? null;
		if (!this.roomName) return;
		this.reportedAt = Date.now();
		try {
			await this.env.ROOM_DIRECTORY.getByName("directory").report(
				this.roomName,
				this.roster().length,
			);
		} catch {
			// a directory outage only stales the room list
		}
	}

	private send(ws: WebSocket, message: ServerMessage): void {
		ws.send(JSON.stringify(message));
	}

	// append one event row to the persisted stream and broadcast the hydrated entry
	private record(fields: Omit<EventRow, "seq" | "bg">): void {
		const result = this.ctx.storage.sql.exec<{ seq: number }>(
			`INSERT INTO events (event_type, avatar, name, text, mode, face_index, face_emotion_index, face_intensity_tenths, torso_index, torso_emotion_index, torso_intensity_tenths, requested, talk_tos_json, background_name, at, bg)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
			fields.event_type,
			fields.avatar,
			fields.name,
			fields.text,
			fields.mode,
			fields.face_index,
			fields.face_emotion_index,
			fields.face_intensity_tenths,
			fields.torso_index,
			fields.torso_emotion_index,
			fields.torso_intensity_tenths,
			fields.requested,
			fields.talk_tos_json,
			fields.background_name,
			Date.now(),
			this.background,
		);
		const seq = result.one().seq;
		if (seq > HISTORY_RETENTION)
			this.ctx.storage.sql.exec(
				"DELETE FROM events WHERE seq <= ?",
				seq - HISTORY_RETENTION,
			);
		const entry = entryFromRow({ ...fields, seq, bg: this.background });
		if (entry) this.broadcast({ type: "entry", entry });
	}

	private emptyEvent(
		event_type: string,
		avatar: number | null,
		name: string,
	): Omit<EventRow, "seq" | "bg"> {
		return {
			event_type,
			avatar,
			name,
			text: null,
			mode: null,
			face_index: null,
			face_emotion_index: null,
			face_intensity_tenths: null,
			torso_index: null,
			torso_emotion_index: null,
			torso_intensity_tenths: null,
			requested: null,
			talk_tos_json: null,
			background_name: null,
		};
	}

	private recordChat(
		seat: SocketSeat,
		text: string,
		mode: ChatMode,
		annotation: ComicAnnotation,
	): void {
		this.record({
			...this.emptyEvent("chat", seat.avatar, seat.name),
			text,
			mode,
			face_index: annotation.faceIndex,
			face_emotion_index: annotation.faceEmotionIndex,
			face_intensity_tenths: Math.round(annotation.faceIntensity * 10),
			torso_index: annotation.torsoIndex,
			torso_emotion_index: annotation.torsoEmotionIndex,
			torso_intensity_tenths: Math.round(annotation.torsoIntensity * 10),
			requested: annotation.requested ? 1 : 0,
			talk_tos_json: JSON.stringify(annotation.talkTos),
		});
	}

	private recordBackground(seat: SocketSeat, name: string): void {
		this.record({
			...this.emptyEvent("background", seat.avatar, seat.name),
			background_name: name,
		});
	}

	private recordAnnounce(
		kind: AnnounceKind,
		avatar: number,
		name: string,
		detail: string,
	): void {
		this.record({ ...this.emptyEvent(kind, avatar, name), text: detail });
	}

	private broadcast(message: ServerMessage): void {
		const raw = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			if (this.seatOf(ws)) ws.send(raw);
		}
	}

	// background is the chunk's replay seed; an empty chunk falls back to where the room stands now
	private history(before?: number): {
		entries: RoomEntry[];
		background: string;
	} {
		const rows =
			before === undefined
				? this.ctx.storage.sql
						.exec<EventRow>(
							`SELECT ${EVENT_COLUMNS} FROM events ORDER BY seq DESC LIMIT ?`,
							HISTORY_CHUNK,
						)
						.toArray()
				: this.ctx.storage.sql
						.exec<EventRow>(
							`SELECT ${EVENT_COLUMNS} FROM events WHERE seq < ? ORDER BY seq DESC LIMIT ?`,
							before,
							HISTORY_CHUNK,
						)
						.toArray();
		rows.reverse();
		const background = rows[0]?.bg ?? this.background;
		return {
			entries: rows
				.map(entryFromRow)
				.filter((entry): entry is RoomEntry => entry !== null),
			background,
		};
	}

	async webSocketMessage(
		ws: WebSocket,
		raw: string | ArrayBuffer,
	): Promise<void> {
		if (!this.takeRateToken(ws)) {
			if ((this.stateOf(ws).strikes ?? 0) >= FLOOD_CLOSE_STRIKES)
				ws.close(1008, RATE_LIMIT_REASON);
			else this.send(ws, { type: "error", reason: RATE_LIMIT_REASON });
			return;
		}
		const message = parseClientMessage(raw);
		if (!message) {
			this.send(ws, { type: "error", reason: "malformed message" });
			return;
		}
		const seat = this.seatOf(ws);
		if (message.type === "join") {
			if (seat) {
				this.send(ws, { type: "error", reason: "already joined" });
				return;
			}
			if (isProhibited(message.name)) {
				this.send(ws, { type: "error", reason: NAME_BLOCKED_REASON });
				return;
			}
			const avatar = pickAvatar(
				message.avatar,
				this.roster().map((entry) => entry.avatar),
			);
			if (avatar === null) {
				this.send(ws, { type: "error", reason: "room is full" });
				ws.close(1008, "room is full");
				return;
			}
			ws.serializeAttachment({
				...this.stateOf(ws),
				name: message.name,
				avatar,
				...(message.sent !== undefined
					? { skew: Date.now() - message.sent }
					: {}),
			});
			const welcomeHistory = this.history();
			this.send(ws, {
				type: "welcome",
				avatar,
				background: this.background,
				historyBackground: welcomeHistory.background,
				roster: this.roster(),
				history: welcomeHistory.entries,
			});
			this.broadcast({
				type: "joined",
				who: { name: message.name, avatar },
			});
			if (message.from !== undefined && message.from !== this.roomName)
				this.recordAnnounce("arrive", avatar, message.name, message.from);
			await this.reportPresence();
			return;
		}
		if (!seat) {
			this.send(ws, { type: "error", reason: "join first" });
			return;
		}
		if (message.type === "history") {
			const chunk = this.history(message.before);
			this.send(ws, {
				type: "history",
				entries: chunk.entries,
				background: chunk.background,
			});
			return;
		}
		// silently drop dead letters: sends that surface long after the sender composed them
		const skew = this.stateOf(ws).skew;
		if (
			message.type === "chat" &&
			message.sent !== undefined &&
			skew !== undefined &&
			Date.now() - message.sent - skew > STALE_SEND_MS
		)
			return;
		const mutedUntil = this.stateOf(ws).mutedUntil ?? 0;
		if (Date.now() < mutedUntil) {
			this.send(ws, {
				type: "error",
				reason: MESSAGE_BLOCKED_REASON,
				retryAfter: mutedUntil - Date.now(),
			});
			return;
		}
		if (message.type === "chat" && isProhibited(message.text)) {
			this.penalize(ws);
			return;
		}
		if (message.type === "depart") {
			this.recordAnnounce("depart", seat.avatar, seat.name, message.to);
			return;
		}
		if (message.type === "profile") {
			if (isProhibited(message.name)) {
				this.send(ws, { type: "error", reason: NAME_BLOCKED_REASON });
				return;
			}
			const avatar =
				message.avatar === seat.avatar
					? seat.avatar
					: (pickAvatar(
							message.avatar,
							this.roster()
								.map((entry) => entry.avatar)
								.filter((taken) => taken !== seat.avatar),
						) ?? seat.avatar);
			if (message.name === seat.name && avatar === seat.avatar) {
				// nothing changed (e.g. a taken avatar was requested); resnap the requester's UI
				this.send(ws, { type: "profile", was: seat, who: seat });
				return;
			}
			ws.serializeAttachment({
				...this.stateOf(ws),
				name: message.name,
				avatar,
			});
			this.broadcast({
				type: "profile",
				was: { name: seat.name, avatar: seat.avatar },
				who: { name: message.name, avatar },
			});
			// old nick announces the new one; the avatar line already speaks as the new nick
			if (message.name !== seat.name)
				this.recordAnnounce("nick", avatar, seat.name, message.name);
			if (avatar !== seat.avatar)
				this.recordAnnounce("avatar", avatar, message.name, String(avatar));
			return;
		}
		if (message.type === "background") {
			this.background = message.name;
			await this.ctx.storage.put("background", message.name);
			this.recordBackground(seat, message.name);
		} else {
			// reject indexes the sender's own avatar cannot render before they reach storage
			if (!annotationInBounds(message.annotation, seat.avatar)) {
				this.send(ws, { type: "error", reason: "malformed message" });
				return;
			}
			this.recordChat(seat, message.text, message.mode, message.annotation);
		}
		if (Date.now() - this.reportedAt > PRESENCE_REFRESH_MS)
			await this.reportPresence();
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const seat = this.seatOf(ws);
		ws.serializeAttachment(null);
		if (seat) {
			this.broadcast({
				type: "left",
				who: { name: seat.name, avatar: seat.avatar },
			});
			await this.reportPresence();
		}
	}
}
