// The events stream: one derived schema contract, and every SQL query that touches it.

import {
	type AnnounceKind,
	type ChatMode,
	type ComicAnnotation,
	DEFAULT_BACKGROUND,
	HISTORY_CHUNK,
	type RoomEntry,
} from "../../src/protocol/room.js";

// storage policy: rows older than this are pruned as newer ones land
const HISTORY_RETENTION = 500;

// single source of truth: column name -> storage type; EventRow and the column list both derive from it
const EVENT_SCHEMA = {
	seq: "int",
	event_type: "text",
	avatar: "int?",
	name: "text",
	text: "text?",
	mode: "int?",
	face_index: "int?",
	face_emotion_index: "int?",
	face_intensity_tenths: "int?",
	torso_index: "int?",
	torso_emotion_index: "int?",
	torso_intensity_tenths: "int?",
	requested: "int?",
	talk_tos_json: "text?",
	background_name: "text?",
} as const satisfies Record<string, "int" | "int?" | "text" | "text?">;

type Stored<C> = C extends "int"
	? number
	: C extends "int?"
		? number | null
		: C extends "text"
			? string
			: string | null;

export type EventRow = {
	[K in keyof typeof EVENT_SCHEMA]: Stored<(typeof EVENT_SCHEMA)[K]>;
};

export const EVENT_FIELDS = Object.keys(EVENT_SCHEMA) as (keyof EventRow)[];
const EVENT_COLUMNS = EVENT_FIELDS.join(", ");
const INSERT_FIELDS = EVENT_FIELDS.filter((field) => field !== "seq");

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

export function entryFromRow(row: EventRow): RoomEntry | null {
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

function emptyRow(
	event_type: string,
	avatar: number | null,
	name: string,
): Omit<EventRow, "seq"> {
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

// Owns the events table: appends hydrate a domain entry, reads replay a chunk with its seed backdrop.
export class EventStore {
	constructor(private readonly sql: SqlStorage) {}

	appendChat(
		avatar: number,
		name: string,
		text: string,
		mode: ChatMode,
		annotation: ComicAnnotation,
	): RoomEntry | null {
		return this.append({
			...emptyRow("chat", avatar, name),
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

	appendBackground(
		avatar: number,
		name: string,
		background: string,
	): RoomEntry | null {
		return this.append({
			...emptyRow("background", avatar, name),
			background_name: background,
		});
	}

	appendAnnounce(
		kind: AnnounceKind,
		avatar: number,
		name: string,
		detail: string,
	): RoomEntry | null {
		return this.append({ ...emptyRow(kind, avatar, name), text: detail });
	}

	// the chunk's replay seed is the newest background event at or before its oldest row; none surviving means the room was still on the default
	history(
		before: number | undefined,
		fallback: string,
	): { entries: RoomEntry[]; background: string } {
		const rows = (
			before === undefined
				? this.sql.exec<EventRow>(
						`SELECT ${EVENT_COLUMNS} FROM events ORDER BY seq DESC LIMIT ?`,
						HISTORY_CHUNK,
					)
				: this.sql.exec<EventRow>(
						`SELECT ${EVENT_COLUMNS} FROM events WHERE seq < ? ORDER BY seq DESC LIMIT ?`,
						before,
						HISTORY_CHUNK,
					)
		).toArray();
		rows.reverse();
		const oldest = rows[0];
		const background =
			oldest === undefined
				? fallback
				: (this.sql
						.exec<{ background_name: string | null }>(
							"SELECT background_name FROM events WHERE event_type = 'background' AND seq <= ? ORDER BY seq DESC LIMIT 1",
							oldest.seq,
						)
						.toArray()[0]?.background_name ?? DEFAULT_BACKGROUND);
		return {
			entries: rows
				.map(entryFromRow)
				.filter((entry): entry is RoomEntry => entry !== null),
			background,
		};
	}

	// append one row to the stream, prune past retention, hydrate the entry to broadcast
	private append(fields: Omit<EventRow, "seq">): RoomEntry | null {
		const values = INSERT_FIELDS.map((field) => fields[field]);
		const seq = this.sql
			.exec<{ seq: number }>(
				`INSERT INTO events (${INSERT_FIELDS.join(", ")}, at) VALUES (${INSERT_FIELDS.map(() => "?").join(", ")}, ?) RETURNING seq`,
				...values,
				Date.now(),
			)
			.one().seq;
		// the prune spares the newest old background event so chunk seeds can always find their backdrop
		if (seq > HISTORY_RETENTION)
			this.sql.exec(
				"DELETE FROM events WHERE seq <= ? AND seq IS NOT (SELECT MAX(seq) FROM events WHERE event_type = 'background' AND seq <= ?)",
				seq - HISTORY_RETENTION,
				seq - HISTORY_RETENTION,
			);
		return entryFromRow({ ...fields, seq } as EventRow);
	}
}
