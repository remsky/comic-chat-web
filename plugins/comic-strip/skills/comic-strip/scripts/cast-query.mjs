#!/usr/bin/env node
// Answers a casting question from the catalog and cast.md, so a strip can be written without reading either in full.

import { readFileSync } from "node:fs";

const catalog = JSON.parse(
	readFileSync(new URL("../reference/catalog.json", import.meta.url), "utf8"),
);
const avatars = new Map(catalog.avatars.map((entry) => [entry.name, entry]));

const cast = readFileSync(
	new URL("../reference/cast.md", import.meta.url),
	"utf8",
);

// the troupe table: | name | look | range |
const notes = new Map();
for (const [, name, look, range] of cast.matchAll(
	/^\| ([a-z]+) \| ([^|]+) \| ([^|]+) \|$/gm,
))
	if (avatars.has(name))
		notes.set(name, { look: look.trim(), range: range.trim() });

// the casting-by-register bullets: - **Label**: `name`, `name`
const registers = [];
for (const [, label, body] of cast.matchAll(/^- \*\*([^*]+)\*\*(.*)$/gm)) {
	const names = [...body.matchAll(/`([a-z]+)`/g)]
		.map((match) => match[1])
		.filter((name) => avatars.has(name));
	if (names.length)
		registers.push({
			label: label.trim(),
			key: label.trim().toLowerCase(),
			names: new Set(names),
		});
}
const creatures = registers.find((group) => group.key.startsWith("creature"));

// prose from cast.md, minus the markdown ticks
const plain = (text) => (text ?? "").replaceAll("`", "");
const rangeOf = (name) => plain(notes.get(name)?.range);
const lookOf = (name) => plain(notes.get(name)?.look);
const isColour = (name) => lookOf(name).includes("(colour");
const isSilent = (name) => rangeOf(name).includes("one drawing");

const usage = () => {
	console.error("usage: cast-query.mjs <character>... | <filters>");
	console.error("  --gesture <name>   owns that pose art");
	console.error("  --emotion <name>   owns that face art");
	console.error(
		`  --register <label> one of: ${registers.map((group) => group.key.split(" ")[0]).join(", ")}`,
	);
	console.error("  --human            not a creature");
	console.error(
		"  --speaks           has more than one drawing, so it can react",
	);
	console.error("  --colour, --mono   full colour art, or line work");
	console.error(
		"filters combine; with no filters, names dump one character each",
	);
};

const die = (message) => {
	console.error(message);
	process.exit(2);
};

const FLAGS = [
	"--gesture",
	"--emotion",
	"--register",
	"--human",
	"--speaks",
	"--colour",
	"--color",
	"--mono",
];
const VALUED = ["--gesture", "--emotion", "--register"];

const args = process.argv.slice(2);
const filters = {};
const names = [];
for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (!arg.startsWith("--")) {
		names.push(arg);
		continue;
	}
	if (!FLAGS.includes(arg)) {
		usage();
		die(`unknown flag "${arg}"`);
	}
	if (!VALUED.includes(arg)) {
		filters[arg === "--color" ? "--colour" : arg] = true;
		continue;
	}
	const value = args[++i];
	if (value === undefined || value.startsWith("--"))
		die(`${arg} needs a value`);
	filters[arg] = value;
}

if (args.length === 0) {
	usage();
	process.exit(2);
}

// one or more named characters: dump each in full and stop
if (names.length > 0) {
	const unknown = names.filter((name) => !avatars.has(name));
	if (unknown.length > 0)
		die(
			`unknown character${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; catalog.json lists all ${avatars.size}`,
		);
	console.log(names.map(describe).join("\n\n"));
	process.exit(0);
}

const gesture = filters["--gesture"];
if (gesture !== undefined) {
	const { base, index } = splitName(gesture);
	const named =
		catalog.gestures.includes(gesture) ||
		(catalog.emotions.includes(base) && index !== undefined);
	if (!named)
		die(
			`unknown gesture "${gesture}"; use one of ${catalog.gestures.join(", ")}, or an <emotion>_<n> stance`,
		);
}

const emotion = filters["--emotion"];
if (emotion !== undefined && !catalog.emotions.includes(emotion))
	die(
		`unknown emotion "${emotion}"; use one of ${catalog.emotions.join(", ")}`,
	);

const wanted = filters["--register"];
const register =
	wanted === undefined
		? undefined
		: registers.find((group) => group.key.startsWith(wanted.toLowerCase()));
if (wanted !== undefined && register === undefined)
	die(
		`unknown register "${wanted}"; use one of ${registers.map((group) => group.key.split(" ")[0]).join(", ")}`,
	);

const matched = [...avatars.keys()].filter((name) => {
	const entry = avatars.get(name);
	if (gesture !== undefined && !(entry.gestures ?? []).includes(gesture))
		return false;
	if (emotion !== undefined && !(entry.emotions[emotion] > 0)) return false;
	if (register !== undefined && !register.names.has(name)) return false;
	if (filters["--human"] && creatures?.names.has(name)) return false;
	if (filters["--speaks"] && isSilent(name)) return false;
	if (filters["--colour"] && !isColour(name)) return false;
	if (filters["--mono"] && isColour(name)) return false;
	return true;
});

const query = Object.entries(filters)
	.map(([flag, value]) => (value === true ? flag : `${flag} ${value}`))
	.join(" ");
console.log(`${query}: ${matched.length} of ${avatars.size} characters`);
for (const name of matched) {
	const alias = emotion !== undefined && avatars.get(name).aliases?.[emotion];
	const note = alias ? ` [draws ${emotion} with its ${alias} art]` : "";
	console.log(`  ${name.padEnd(10)} ${lookOf(name)}${note}`);
}
if (matched.length === 0)
	console.log("  nobody. drop a filter, or read cast.md and choose on feeling");

// "happy_2" -> happy, 2; a bare name carries no index
function splitName(name) {
	const match = /^([a-z]+)_(\d+)$/.exec(name);
	return match ? { base: match[1], index: Number(match[2]) } : { base: name };
}

function describe(name) {
	const entry = avatars.get(name);
	const faces = Object.entries(entry.emotions)
		.filter(([, count]) => count > 0)
		.map(([face, count]) => {
			const alias = entry.aliases?.[face];
			return alias ? `${face} ${count} (=${alias})` : `${face} ${count}`;
		})
		.join(", ");
	const groups = registers
		.filter((group) => group.names.has(name))
		.map((group) => group.label);
	const lines = [name];
	if (notes.has(name))
		lines.push(`  look     ${lookOf(name)}`, `  range    ${rangeOf(name)}`);
	lines.push(`  faces    ${faces}`);
	lines.push(`  poses    ${(entry.gestures ?? []).join(", ") || "none"}`);
	if (groups.length > 0) lines.push(`  register ${groups.join("; ")}`);
	return lines.join("\n");
}
