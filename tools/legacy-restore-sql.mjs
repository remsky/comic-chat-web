// Rebuilds a legacy messages table from a CSV export for 0002_legacy_backfill.sql to convert; kept for recovery and dry runs since 0002 drops messages.

import { readFileSync } from "node:fs";

const COLUMNS = [
	"seq",
	"avatar",
	"name",
	"text",
	"mode",
	"at",
	"expr",
	"gest",
	"req",
	"bg",
];
const NUMERIC = new Set(["seq", "avatar", "mode", "at", "expr", "gest", "req"]);
const NULLABLE = new Set(["expr", "gest", "req", "bg"]);
const ROWS_PER_INSERT = 200;

function parseCsv(raw) {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index];
		if (quoted) {
			if (char === '"') {
				if (raw[index + 1] === '"') {
					field += '"';
					index++;
				} else quoted = false;
			} else field += char;
		} else if (char === '"') quoted = true;
		else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && raw[index + 1] === "\n") index++;
			row.push(field);
			rows.push(row);
			field = "";
			row = [];
		} else field += char;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((cells) => cells.length > 1 || cells[0] !== "");
}

function sqlValue(column, value) {
	if (NUMERIC.has(column)) {
		if (value === "") {
			if (!NULLABLE.has(column)) throw new Error(`${column} is empty`);
			return "NULL";
		}
		if (!/^-?\d+$/.test(value))
			throw new Error(`${column} is not an integer: ${value}`);
		return value;
	}
	if (value === "" && NULLABLE.has(column)) return "NULL";
	return `'${value.replaceAll("'", "''")}'`;
}

const path = process.argv[2];
if (path === undefined) {
	console.error("usage: node tools/legacy-restore-sql.mjs <backup.csv>");
	process.exit(1);
}
const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
const layout = COLUMNS.map((column) => {
	const at = header?.indexOf(column) ?? -1;
	if (at === -1) throw new Error(`missing column: ${column}`);
	return { column, at };
});

console.log(`CREATE TABLE IF NOT EXISTS messages (
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
);`);
for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
	const values = rows
		.slice(start, start + ROWS_PER_INSERT)
		.map(
			(cells) =>
				`(${layout.map(({ column, at }) => sqlValue(column, cells[at] ?? "")).join(", ")})`,
		);
	console.log(
		`INSERT INTO messages (${COLUMNS.join(", ")}) VALUES\n${values.join(",\n")};`,
	);
}
