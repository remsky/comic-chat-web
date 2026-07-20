// One Durable Object per chat room: WebSocket hibernation, SQLite history, cast seat assignment.

import { DurableObject } from "cloudflare:workers";
import {
	BACKGROUND_MODE,
	type ChatEntry,
	DEFAULT_BACKGROUND,
	HISTORY_CHUNK,
	parseClientMessage,
	pickAvatar,
	RATE_LIMIT_REASON,
	type RosterEntry,
	roomNameFromPath,
	type ServerMessage,
} from "../src/protocol/room.js";
import { isProhibited } from "./moderation.js";

// server policy: bound per-room storage, connections, and per-socket send rate
const HISTORY_RETENTION = 500;
const SOCKET_LIMIT = 12;
const RATE_BURST = 10;
const RATE_REFILL_MS = 500;
// a rate-limited message is dropped with an error; only this many consecutive drops closes the socket
const FLOOD_CLOSE_STRIKES = 20;
// each blocked message mutes the socket for strikes * this, so repeat offenders wait longer
const MUTE_STEP_MS = 30_000;
// after this many blocked messages the socket is closed rather than muted again
const MOD_CLOSE_STRIKES = 5;
const MESSAGE_BLOCKED_REASON = "message blocked";
// keep the directory's last-active fresh for idle-but-chatty rooms without a report per message
const PRESENCE_REFRESH_MS = 5 * 60 * 1000;

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
}

export class ChatRoomDO extends DurableObject<Env> {
	// ctx.id.name is unavailable after a hibernation wake, so the name is persisted on connect
	private roomName: string | null = null;
	private reportedAt = 0;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS messages (
					seq INTEGER PRIMARY KEY AUTOINCREMENT,
					avatar INTEGER NOT NULL,
					name TEXT NOT NULL,
					text TEXT NOT NULL,
					mode INTEGER NOT NULL,
					at INTEGER NOT NULL,
					expr INTEGER,
					gest INTEGER,
					req INTEGER
				)
			`);
			const columns = this.ctx.storage.sql
				.exec<{ name: string }>("PRAGMA table_info(messages)")
				.toArray()
				.map((column) => column.name);
			for (const column of ["expr", "gest", "req"]) {
				if (!columns.includes(column))
					this.ctx.storage.sql.exec(
						`ALTER TABLE messages ADD COLUMN ${column} INTEGER`,
					);
			}
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
		ws.serializeAttachment({
			...state,
			modStrikes,
			mutedUntil: Date.now() + modStrikes * MUTE_STEP_MS,
		});
		this.send(ws, { type: "error", reason: MESSAGE_BLOCKED_REASON });
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

	private broadcast(message: ServerMessage): void {
		const raw = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			if (this.seatOf(ws)) ws.send(raw);
		}
	}

	private history(before?: number): ChatEntry[] {
		const rows =
			before === undefined
				? this.ctx.storage.sql
						.exec<{
							seq: number;
							avatar: number;
							name: string;
							text: string;
							mode: number;
							expr: number | null;
							gest: number | null;
							req: number | null;
						}>(
							"SELECT seq, avatar, name, text, mode, expr, gest, req FROM messages ORDER BY seq DESC LIMIT ?",
							HISTORY_CHUNK,
						)
						.toArray()
				: this.ctx.storage.sql
						.exec<{
							seq: number;
							avatar: number;
							name: string;
							text: string;
							mode: number;
							expr: number | null;
							gest: number | null;
							req: number | null;
						}>(
							"SELECT seq, avatar, name, text, mode, expr, gest, req FROM messages WHERE seq < ? ORDER BY seq DESC LIMIT ?",
							before,
							HISTORY_CHUNK,
						)
						.toArray();
		return rows
			.reverse()
			.map(({ expr, gest, req, ...entry }) =>
				expr !== null && gest !== null && req !== null
					? { ...entry, pose: { expr, gest, req } }
					: entry,
			);
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
				this.send(ws, { type: "error", reason: "name blocked" });
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
			});
			this.send(ws, {
				type: "welcome",
				avatar,
				background:
					(await this.ctx.storage.get<string>("background")) ??
					DEFAULT_BACKGROUND,
				roster: this.roster(),
				history: this.history(),
			});
			this.broadcast({
				type: "joined",
				who: { name: message.name, avatar },
			});
			await this.reportPresence();
			return;
		}
		if (!seat) {
			this.send(ws, { type: "error", reason: "join first" });
			return;
		}
		if (message.type === "history") {
			this.send(ws, { type: "history", entries: this.history(message.before) });
			return;
		}
		const mutedUntil = this.stateOf(ws).mutedUntil ?? 0;
		if (Date.now() < mutedUntil) {
			this.send(ws, { type: "error", reason: MESSAGE_BLOCKED_REASON });
			return;
		}
		if (message.type === "chat" && isProhibited(message.text)) {
			this.penalize(ws);
			return;
		}
		// background changes ride the message stream so replay recomposes identically everywhere
		const text = message.type === "background" ? message.name : message.text;
		const mode = message.type === "background" ? BACKGROUND_MODE : message.mode;
		const pose = message.type === "background" ? undefined : message.pose;
		if (message.type === "background")
			await this.ctx.storage.put("background", message.name);
		const result = this.ctx.storage.sql.exec<{ seq: number }>(
			"INSERT INTO messages (avatar, name, text, mode, at, expr, gest, req) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq",
			seat.avatar,
			seat.name,
			text,
			mode,
			Date.now(),
			pose?.expr ?? null,
			pose?.gest ?? null,
			pose?.req ?? null,
		);
		const seq = result.one().seq;
		if (seq > HISTORY_RETENTION)
			this.ctx.storage.sql.exec(
				"DELETE FROM messages WHERE seq <= ?",
				seq - HISTORY_RETENTION,
			);
		this.broadcast({
			type: "chat",
			entry: {
				seq,
				avatar: seat.avatar,
				name: seat.name,
				text,
				mode,
				...(pose ? { pose } : {}),
			},
		});
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
