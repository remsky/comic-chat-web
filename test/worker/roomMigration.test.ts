import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "../../worker/db/migrations.js";
import { join } from "./helpers.js";

const LEGACY_TABLE = `CREATE TABLE messages (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	avatar INTEGER NOT NULL,
	name TEXT NOT NULL,
	text TEXT NOT NULL,
	mode INTEGER NOT NULL,
	at INTEGER NOT NULL,
	expr INTEGER,
	gest INTEGER,
	req INTEGER,
	bg TEXT
)`;

const LEGACY_INSERT =
	"INSERT INTO messages (avatar, name, text, mode, at, expr, gest, req, bg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

describe("legacy history migration", () => {
	it("carries messages rows into events with poses intact", async () => {
		const room = "legacy-migrate";
		const stub = env.CHAT_ROOM.getByName(room);
		// rewind the migrated state so the room looks like a legacy deploy mid-upgrade
		await runInDurableObject(stub, (_instance, state) => {
			state.storage.sql.exec("DROP TABLE events; DELETE FROM _migrations;");
			state.storage.sql.exec(LEGACY_TABLE);
			const rows: [
				number,
				string,
				string,
				number,
				number | null,
				number | null,
				number | null,
			][] = [
				[18, "remsky", "volcano", 6, null, null, null],
				[18, "remsky", "Oh wow", 1, 2, 0, 0],
				[18, "remsky", "time*", 5, 5, 4, 1],
				[18, "remsky", "18", 8, null, null, null],
				[2, "Tim", "pen-pals", 9, null, null, null],
				[2, "Tim", "dial-up", 10, null, null, null],
			];
			for (const [avatar, name, text, mode, expr, gest, req] of rows)
				state.storage.sql.exec(
					LEGACY_INSERT,
					avatar,
					name,
					text,
					mode,
					Date.now(),
					expr,
					gest,
					req,
					"volcano",
				);
			applyMigrations(state.storage);
			// the source table is gone once its rows live in events
			const tables = state.storage.sql
				.exec<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE name = 'messages'",
				)
				.toArray();
			expect(tables).toEqual([]);
		});
		const { welcome, socket } = await join(room, "ann", 1);
		expect(welcome.historyBackground).toBe("volcano");
		expect(welcome.history).toEqual([
			{ type: "background", seq: 1, name: "volcano", by: "remsky" },
			{
				type: "chat",
				seq: 2,
				userId: "",
				avatar: 18,
				name: "remsky",
				text: "Oh wow",
				mode: 1,
				annotation: {
					faceIndex: 2,
					faceEmotionIndex: 9,
					faceIntensity: 0,
					torsoIndex: 0,
					torsoEmotionIndex: 0,
					torsoIntensity: 0,
					requested: false,
					talkTos: [],
				},
			},
			{
				type: "chat",
				seq: 3,
				userId: "",
				avatar: 18,
				name: "remsky",
				text: "time*",
				mode: 5,
				annotation: {
					faceIndex: 5,
					faceEmotionIndex: 9,
					faceIntensity: 0,
					torsoIndex: 4,
					torsoEmotionIndex: 0,
					torsoIntensity: 0,
					requested: true,
					talkTos: [],
				},
			},
			{
				type: "announce",
				kind: "avatar",
				seq: 4,
				userId: "",
				avatar: 18,
				name: "remsky",
				detail: "18",
			},
			{
				type: "announce",
				kind: "depart",
				seq: 5,
				userId: "",
				avatar: 2,
				name: "Tim",
				detail: "pen-pals",
			},
			{
				type: "announce",
				kind: "arrive",
				seq: 6,
				userId: "",
				avatar: 2,
				name: "Tim",
				detail: "dial-up",
			},
		]);
		socket.close();
	});

	it("migrates rooms predating the pose columns", async () => {
		const room = "legacy-migrate-ancient";
		const stub = env.CHAT_ROOM.getByName(room);
		await runInDurableObject(stub, (_instance, state) => {
			state.storage.sql.exec("DROP TABLE events; DELETE FROM _migrations;");
			// a room last woken before expr/gest/req existed: the reconcile step adds them
			state.storage.sql.exec(`CREATE TABLE messages (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				avatar INTEGER NOT NULL,
				name TEXT NOT NULL,
				text TEXT NOT NULL,
				mode INTEGER NOT NULL,
				at INTEGER NOT NULL
			)`);
			state.storage.sql.exec(
				"INSERT INTO messages (avatar, name, text, mode, at) VALUES (?, ?, ?, ?, ?)",
				7,
				"old-timer",
				"hello from 1996",
				1,
				Date.now(),
			);
			applyMigrations(state.storage);
		});
		const { welcome, socket } = await join(room, "ann", 1);
		expect(welcome.historyBackground).toBe("field");
		expect(welcome.history).toEqual([
			{
				type: "chat",
				seq: 1,
				userId: "",
				avatar: 7,
				name: "old-timer",
				text: "hello from 1996",
				mode: 1,
				annotation: {
					faceIndex: 0,
					faceEmotionIndex: 9,
					faceIntensity: 0,
					torsoIndex: 0,
					torsoEmotionIndex: 0,
					torsoIntensity: 0,
					requested: false,
					talkTos: [],
				},
			},
		]);
		socket.close();
	});
});
