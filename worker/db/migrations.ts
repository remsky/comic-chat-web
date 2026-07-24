// Per-room schema migrations: each SQL file or function step runs once, in order, tracked in _migrations.

import events from "../do_migrations/0001_events.sql";
import legacyBackfill from "../do_migrations/0002_legacy_backfill.sql";
import senderId from "../do_migrations/0003_sender_id.sql";

type Migration = string | ((storage: DurableObjectStorage) => void);

// table/column names come from migration definitions, never user input, so they go straight into DDL
export function ensureColumns(
	sql: SqlStorage,
	table: string,
	columns: Record<string, string>,
): void {
	const existing = new Set(
		sql
			.exec<{ name: string }>(`PRAGMA table_info(${table})`)
			.toArray()
			.map((column) => column.name),
	);
	if (existing.size === 0) return; // table absent: nothing to reconcile
	for (const [name, type] of Object.entries(columns))
		if (!existing.has(name))
			sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

const MIGRATIONS: Migration[] = [
	events,
	// a legacy messages table may predate the pose columns the backfill reads
	(storage) =>
		ensureColumns(storage.sql, "messages", {
			expr: "INTEGER",
			gest: "INTEGER",
			req: "INTEGER",
		}),
	legacyBackfill,
	senderId,
];

// WATCH: cloudflare/actors SQLSchemaMigrations is this same pattern; adopt if it stabilizes and we want its framework.
export function applyMigrations(storage: DurableObjectStorage): void {
	const sql = storage.sql;
	sql.exec(
		"CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, at INTEGER NOT NULL)",
	);
	const applied =
		sql
			.exec<{ version: number | null }>(
				"SELECT MAX(version) AS version FROM _migrations",
			)
			.one().version ?? 0;
	MIGRATIONS.forEach((step, index) => {
		if (index < applied) return;
		storage.transactionSync(() => {
			if (typeof step === "string") sql.exec(step);
			else step(storage);
			sql.exec(
				"INSERT INTO _migrations (version, at) VALUES (?, ?)",
				index + 1,
				Date.now(),
			);
		});
	});
}
