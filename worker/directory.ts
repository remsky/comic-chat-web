// Room directory: one well-known Durable Object tracking live rooms for the connect screen.

import { DurableObject } from "cloudflare:workers";
import type { RoomListing } from "../src/protocol/room.js";

// a crashed room stops reporting; drop it after a day without activity
const STALE_MS = 24 * 60 * 60 * 1000;

export class RoomDirectoryDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS rooms (
					name TEXT PRIMARY KEY,
					members INTEGER NOT NULL,
					active INTEGER NOT NULL
				)
			`);
		});
	}

	// rooms report on join/leave and periodically while chatting; an emptied room keeps its row so the connect screen can say how recently it was alive
	report(name: string, members: number): void {
		this.ctx.storage.sql.exec(
			"INSERT INTO rooms (name, members, active) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET members = excluded.members, active = excluded.active",
			name,
			Math.max(0, members),
			Date.now(),
		);
	}

	list(): RoomListing[] {
		this.ctx.storage.sql.exec(
			"DELETE FROM rooms WHERE active < ?",
			Date.now() - STALE_MS,
		);
		return this.ctx.storage.sql
			.exec<{ name: string; members: number; active: number }>(
				"SELECT name, members, active FROM rooms ORDER BY members DESC, name",
			)
			.toArray() satisfies RoomListing[];
	}
}
