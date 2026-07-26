#!/usr/bin/env node
// Checks a strip document against the published catalog, then prints the link that opens it in the studio.

import { readFileSync } from "node:fs";

const DEFAULT_BASE = "https://comics.remsky.art";
const LONG_BALLOON = 90;

const catalog = JSON.parse(
	readFileSync(new URL("../reference/catalog.json", import.meta.url), "utf8"),
);
const avatars = new Map(catalog.avatars.map((entry) => [entry.name, entry]));

const STRIP_KEYS = ["version", "size", "seed", "columns", "panels"];
const PANEL_KEYS = ["background", "camera", "zoom", "border", "actors"];
const ACTOR_KEYS = ["avatar", "text", "mode", "emotion", "gesture", "facing"];

const issues = [];
const fail = (path, message) =>
	issues.push({ path, message, severity: "error" });
const warn = (path, message) =>
	issues.push({ path, message, severity: "warning" });

const isRecord = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// "happy_2" -> happy, 2; a bare name carries no index
function splitName(name) {
	const match = /^([a-z]+)_(\d+)$/.exec(name);
	return match ? { base: match[1], index: Number(match[2]) } : { base: name };
}

function checkKeys(raw, allowed, path) {
	for (const key of Object.keys(raw))
		if (!allowed.includes(key))
			warn(path ? `${path}.${key}` : key, `unknown field "${key}"`);
}

function checkEnum(raw, key, allowed, path) {
	if (raw[key] === undefined) return;
	if (!allowed.includes(raw[key]))
		fail(
			`${path}.${key}`,
			`unknown ${key} "${String(raw[key])}"; use one of ${allowed.join(", ")}`,
		);
}

function checkActor(raw, path) {
	if (!isRecord(raw)) {
		fail(path, "actor must be an object");
		return;
	}
	checkKeys(raw, ACTOR_KEYS, path);
	const entry = avatars.get(raw.avatar);
	if (typeof raw.avatar !== "string" || raw.avatar === "")
		fail(`${path}.avatar`, "avatar is required");
	else if (!entry) fail(`${path}.avatar`, `unknown character "${raw.avatar}"`);

	if (raw.text !== undefined && typeof raw.text !== "string")
		fail(`${path}.text`, "text must be a string");
	else if (typeof raw.text === "string" && raw.text.length > LONG_BALLOON)
		warn(
			`${path}.text`,
			`${raw.text.length} characters will crowd the art; split it across panels`,
		);

	checkEnum(raw, "mode", catalog.modes, path);
	checkEnum(raw, "facing", catalog.facings, path);

	if (raw.emotion !== undefined) {
		const { base, index } = splitName(String(raw.emotion));
		const count = entry?.emotions[base] ?? 0;
		if (!catalog.emotions.includes(base))
			fail(`${path}.emotion`, `unknown emotion "${String(raw.emotion)}"`);
		else if (entry && count === 0)
			warn(
				`${path}.emotion`,
				`${entry.name} has no "${base}" art and will pose neutral`,
			);
		else if (index !== undefined && (index < 1 || index > count))
			fail(
				`${path}.emotion`,
				`${entry?.name} draws ${count} "${base}" face(s), so "${base}" or "${base}_1" to "${base}_${count}"`,
			);
		// an aliased emotion is legal and draws nothing new, which is worth saying before it reaches a panel
		const alias = entry?.aliases?.[base];
		if (alias !== undefined)
			warn(
				`${path}.emotion`,
				`${entry.name} draws "${base}" with its "${alias}" faces, so the two look the same`,
			);
	}

	if (raw.gesture !== undefined) {
		const gesture = String(raw.gesture);
		const { base, index } = splitName(gesture);
		const named =
			catalog.gestures.includes(gesture) ||
			(catalog.emotions.includes(base) && index !== undefined);
		if (!named) fail(`${path}.gesture`, `unknown gesture "${gesture}"`);
		else if (entry && !(entry.gestures ?? []).includes(gesture))
			warn(
				`${path}.gesture`,
				`${entry.name} has no "${gesture}" art and will pose neutral`,
			);
	}
}

function checkPanel(raw, path) {
	if (!isRecord(raw)) {
		fail(path, "panel must be an object");
		return;
	}
	checkKeys(raw, PANEL_KEYS, path);
	if (raw.background !== undefined && raw.background !== "")
		checkEnum(raw, "background", catalog.backgrounds, path);
	checkEnum(raw, "camera", catalog.cameras, path);

	const [zoomMin, zoomMax] = catalog.limits.zoom;
	if (raw.zoom !== undefined) {
		if (typeof raw.zoom !== "number" || !Number.isFinite(raw.zoom))
			fail(`${path}.zoom`, "zoom must be a number");
		else if (raw.zoom < zoomMin || raw.zoom > zoomMax)
			fail(`${path}.zoom`, `zoom must be ${zoomMin} to ${zoomMax}`);
	}
	if (raw.border !== undefined && typeof raw.border !== "boolean")
		fail(`${path}.border`, "border must be a boolean");

	if (!Array.isArray(raw.actors)) {
		fail(`${path}.actors`, "actors must be an array");
		return;
	}
	if (raw.actors.length === 0) warn(`${path}.actors`, "panel draws nobody");
	if (raw.actors.length > catalog.limits.actors)
		fail(
			`${path}.actors`,
			`a panel holds at most ${catalog.limits.actors} characters`,
		);
	const balloons = raw.actors.filter(
		(actor) => isRecord(actor) && actor.text,
	).length;
	if (balloons > catalog.limits.balloons)
		fail(
			`${path}.actors`,
			`a panel holds at most ${catalog.limits.balloons} balloons`,
		);
	raw.actors.forEach((actor, index) => {
		checkActor(actor, `${path}.actors[${index}]`);
	});
}

function checkStrip(raw) {
	if (!isRecord(raw)) {
		fail("", "strip must be a JSON object");
		return;
	}
	checkKeys(raw, STRIP_KEYS, "");
	if (raw.version !== catalog.version)
		warn("version", `expected version ${catalog.version}`);
	checkEnum(raw, "size", catalog.sizes, "");
	if (raw.seed !== undefined && !Number.isInteger(raw.seed))
		fail("seed", "seed must be an integer");

	const [colMin, colMax] = catalog.limits.columns;
	if (raw.columns !== undefined) {
		if (!Number.isInteger(raw.columns))
			fail("columns", "columns must be an integer");
		else if (raw.columns < colMin || raw.columns > colMax)
			fail("columns", `columns must be ${colMin} to ${colMax}`);
	}

	if (!Array.isArray(raw.panels)) {
		fail("panels", "panels must be an array");
		return;
	}
	if (raw.panels.length === 0) warn("panels", "strip has no panels");
	raw.panels.forEach((panel, index) => {
		checkPanel(panel, `panels[${index}]`);
	});
}

function link(strip, base) {
	const encoded = Buffer.from(JSON.stringify(strip))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `${base.replace(/\/$/, "")}/studio.html?script=${encoded}`;
}

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = baseFlag >= 0 ? args[baseFlag + 1] : DEFAULT_BASE;
const baseValue = baseFlag >= 0 ? baseFlag + 1 : -1;
const file = args.find(
	(arg, index) => !arg.startsWith("--") && index !== baseValue,
);
if (!file) {
	console.error("usage: strip-link.mjs <strip.json> [--base <url>]");
	process.exit(2);
}

let strip;
try {
	strip = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
	console.error(`${file}: ${error.message}`);
	process.exit(1);
}

checkStrip(strip);
for (const issue of issues)
	console.error(
		`${issue.severity}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
	);

const errors = issues.filter((issue) => issue.severity === "error").length;
if (errors > 0) {
	console.error(`${errors} error(s); the studio will refuse these fields`);
	process.exit(1);
}

const url = link(strip, base);
const cast = new Set(
	strip.panels.flatMap((panel) => panel.actors.map((actor) => actor.avatar)),
);
console.log(
	`ok: ${strip.panels.length} panel(s), ${cast.size} character(s), ${url.length} byte link`,
);
console.log(url);
