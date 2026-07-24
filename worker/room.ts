// One Durable Object per chat room: WebSocket hibernation, SQLite history, cast seat assignment.

import { DurableObject } from "cloudflare:workers";
import {
	annotationInBounds,
	DEFAULT_BACKGROUND,
	MESSAGE_BLOCKED_REASON,
	NAME_BLOCKED_REASON,
	parseClientMessage,
	pickAvatar,
	RATE_LIMIT_REASON,
	type RoomEntry,
	type RosterEntry,
	roomNameFromPath,
	type ServerMessage,
} from "../src/protocol/room.js";
import { EventStore } from "./db/events.js";
import { applyMigrations } from "./db/migrations.js";
import { isProhibited } from "./moderation.js";

// server policy: bound connections and per-socket send rate
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

export class ChatRoomDO extends DurableObject<Env> {
	// ctx.id.name is unavailable after a hibernation wake, so the name is persisted on connect
	private roomName: string | null = null;
	private reportedAt = 0;
	// mirrors the stored background so tagging each insert costs no storage read
	private background = DEFAULT_BACKGROUND;
	private readonly events = new EventStore(this.ctx.storage.sql);

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// answer client liveness pings in the runtime without waking the hibernated DO
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
		ctx.blockConcurrencyWhile(async () => {
			applyMigrations(this.ctx.storage);
			this.background =
				(await this.ctx.storage.get<string>("background")) ??
				DEFAULT_BACKGROUND;
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

	private broadcast(message: ServerMessage): void {
		const raw = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			if (this.seatOf(ws)) ws.send(raw);
		}
	}

	private emit(entry: RoomEntry | null): void {
		if (entry) this.broadcast({ type: "entry", entry });
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
			const welcomeHistory = this.events.history(undefined, this.background);
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
				this.emit(
					this.events.appendAnnounce(
						"arrive",
						avatar,
						message.name,
						message.from,
					),
				);
			await this.reportPresence();
			return;
		}
		if (!seat) {
			this.send(ws, { type: "error", reason: "join first" });
			return;
		}
		if (message.type === "history") {
			const chunk = this.events.history(message.before, this.background);
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
			this.emit(
				this.events.appendAnnounce(
					"depart",
					seat.avatar,
					seat.name,
					message.to,
				),
			);
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
				this.emit(
					this.events.appendAnnounce("nick", avatar, seat.name, message.name),
				);
			if (avatar !== seat.avatar)
				this.emit(
					this.events.appendAnnounce(
						"avatar",
						avatar,
						message.name,
						String(avatar),
					),
				);
			return;
		}
		if (message.type === "background") {
			this.background = message.name;
			await this.ctx.storage.put("background", message.name);
			this.emit(
				this.events.appendBackground(seat.avatar, seat.name, message.name),
			);
		} else {
			// reject indexes the sender's own avatar cannot render before they reach storage
			if (!annotationInBounds(message.annotation, seat.avatar)) {
				this.send(ws, { type: "error", reason: "malformed message" });
				return;
			}
			this.emit(
				this.events.appendChat(
					seat.avatar,
					seat.name,
					message.text,
					message.mode,
					message.annotation,
				),
			);
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
