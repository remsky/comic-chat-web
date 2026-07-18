// One Durable Object per chat room: WebSocket hibernation, SQLite history, cast seat assignment.

import { DurableObject } from "cloudflare:workers";
import {
	type ChatEntry,
	parseClientMessage,
	pickAvatar,
	type RosterEntry,
	type ServerMessage,
} from "../src/protocol/room.js";

interface SocketSeat {
	name: string;
	avatar: number;
}

export class ChatRoomDO extends DurableObject<Env> {
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
					at INTEGER NOT NULL
				)
			`);
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket")
			return new Response("expected a websocket upgrade", { status: 426 });
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	private seatOf(ws: WebSocket): SocketSeat | null {
		return (ws.deserializeAttachment() as SocketSeat | null) ?? null;
	}

	private roster(): RosterEntry[] {
		const seats: RosterEntry[] = [];
		for (const ws of this.ctx.getWebSockets()) {
			const seat = this.seatOf(ws);
			if (seat) seats.push({ name: seat.name, avatar: seat.avatar });
		}
		return seats;
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

	private history(): ChatEntry[] {
		return this.ctx.storage.sql
			.exec<{
				seq: number;
				avatar: number;
				name: string;
				text: string;
				mode: number;
			}>("SELECT seq, avatar, name, text, mode FROM messages ORDER BY seq")
			.toArray();
	}

	async webSocketMessage(
		ws: WebSocket,
		raw: string | ArrayBuffer,
	): Promise<void> {
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
			const avatar = pickAvatar(
				message.avatar,
				this.roster().map((entry) => entry.avatar),
			);
			if (avatar === null) {
				this.send(ws, { type: "error", reason: "room is full" });
				ws.close(1008, "room is full");
				return;
			}
			ws.serializeAttachment({ name: message.name, avatar });
			this.send(ws, {
				type: "welcome",
				avatar,
				roster: this.roster(),
				history: this.history(),
			});
			this.broadcast({
				type: "joined",
				who: { name: message.name, avatar },
			});
			return;
		}
		if (!seat) {
			this.send(ws, { type: "error", reason: "join first" });
			return;
		}
		const result = this.ctx.storage.sql.exec<{ seq: number }>(
			"INSERT INTO messages (avatar, name, text, mode, at) VALUES (?, ?, ?, ?, ?) RETURNING seq",
			seat.avatar,
			seat.name,
			message.text,
			message.mode,
			Date.now(),
		);
		this.broadcast({
			type: "chat",
			entry: {
				seq: result.one().seq,
				avatar: seat.avatar,
				name: seat.name,
				text: message.text,
				mode: message.mode,
			},
		});
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const seat = this.seatOf(ws);
		ws.serializeAttachment(null);
		if (seat)
			this.broadcast({
				type: "left",
				who: { name: seat.name, avatar: seat.avatar },
			});
	}
}
