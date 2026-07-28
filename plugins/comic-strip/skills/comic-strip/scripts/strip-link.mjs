#!/usr/bin/env node
// Checks a strip document against the published catalog, then prints the link that opens it in the studio.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const DEFAULT_BASE = "https://comics.remsky.art";
const LONG_BALLOON = 90;
const LONG_TITLE = 30;
const LONG_CREDIT = 24;

const catalog = JSON.parse(
	readFileSync(new URL("../reference/catalog.json", import.meta.url), "utf8"),
);
const avatars = new Map(catalog.avatars.map((entry) => [entry.name, entry]));

const STRIP_KEYS = ["version", "size", "seed", "columns", "panels"];
const PANEL_KEYS = [
	"kind",
	"title",
	"starring",
	"footer",
	"background",
	"camera",
	"zoom",
	"border",
	"actors",
];
const ACTOR_KEYS = ["avatar", "text", "mode", "emotion", "gesture", "facing"];
// a title card draws icons and credit rows, so the staging fields have nothing to act on
const SCENE_KEYS = ["background", "camera", "zoom", "border"];
const TITLE_KEYS = ["title", "starring", "footer"];
const LONG_FOOTER = 40;

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

// a star is a name and a credit line; the card poses it from its icon, so the acting fields go unread
function checkStar(raw, path) {
	if (!isRecord(raw)) {
		fail(path, "actor must be an object");
		return;
	}
	checkKeys(raw, ACTOR_KEYS, path);
	if (typeof raw.avatar !== "string" || raw.avatar === "")
		fail(`${path}.avatar`, "avatar is required");
	else if (!avatars.has(raw.avatar))
		fail(`${path}.avatar`, `unknown character "${raw.avatar}"`);

	if (raw.text !== undefined && typeof raw.text !== "string")
		fail(`${path}.text`, "text must be a string");
	else if (typeof raw.text === "string" && raw.text.length > LONG_CREDIT)
		warn(
			`${path}.text`,
			`${raw.text.length} characters is a long credit; the rows centre on the widest one`,
		);

	for (const key of ["mode", "emotion", "gesture", "facing"])
		if (raw[key] !== undefined)
			warn(`${path}.${key}`, `a credit row ignores ${key}`);
}

function checkTitlePanel(raw, path) {
	for (const key of SCENE_KEYS)
		if (raw[key] !== undefined)
			warn(`${path}.${key}`, `a title card ignores ${key}`);

	for (const key of TITLE_KEYS) {
		if (raw[key] === undefined) continue;
		if (typeof raw[key] !== "string")
			fail(`${path}.${key}`, `${key} must be a string`);
	}
	if (typeof raw.title === "string" && raw.title.length > LONG_TITLE)
		warn(
			`${path}.title`,
			`${raw.title.length} characters wraps the title over several lines and crowds the cast off the card`,
		);
	if (typeof raw.footer === "string" && raw.footer.length > LONG_FOOTER)
		warn(
			`${path}.footer`,
			`${raw.footer.length} characters is a long footer; it draws on one line`,
		);

	if (!Array.isArray(raw.actors)) {
		fail(`${path}.actors`, "actors must be an array");
		return;
	}
	if (raw.actors.length === 0)
		warn(`${path}.actors`, "title card credits nobody");
	if (raw.actors.length > catalog.limits.actors)
		fail(
			`${path}.actors`,
			`a card holds at most ${catalog.limits.actors} credit rows`,
		);
	raw.actors.forEach((actor, index) => {
		checkStar(actor, `${path}.actors[${index}]`);
	});
}

function checkPanel(raw, path) {
	if (!isRecord(raw)) {
		fail(path, "panel must be an object");
		return;
	}
	checkKeys(raw, PANEL_KEYS, path);
	checkEnum(raw, "kind", catalog.kinds, path);
	if (raw.kind === "title") {
		checkTitlePanel(raw, path);
		return;
	}
	for (const key of TITLE_KEYS)
		if (raw[key] !== undefined)
			warn(`${path}.${key}`, `${key} draws only on a "title" panel`);
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

// craft rules the studio happily renders and a reader still notices, so they land as warnings
function checkShape(panels) {
	panels.forEach((panel, index) => {
		if (isRecord(panel) && panel.kind === "title" && index > 0)
			warn(
				`panels[${index}]`,
				"a title card opens a strip; this one interrupts one",
			);
	});
	// the card carries no scene, so the staging rules below only count the panels that do
	const drawn = panels
		.map((panel, index) => ({ panel, index }))
		.filter(({ panel }) => isRecord(panel) && panel.kind !== "title");
	if (drawn.length < 3) return;
	const actorsOf = ({ panel }) =>
		(Array.isArray(panel.actors) ? panel.actors : []).filter(isRecord);

	if (drawn.every(({ panel }) => !panel.background))
		warn("panels", "no panel has a backdrop; a blank strip reads unfinished");

	const close = drawn.filter(({ panel }) => panel.camera === "close").length;
	if (close * 2 >= drawn.length)
		warn(
			"panels",
			`${close} of ${drawn.length} panels are close shots; wide should carry most of a strip`,
		);

	if (!drawn.some((entry) => actorsOf(entry).some((actor) => actor.gesture)))
		warn(
			"panels",
			"no panel names a gesture, so every figure holds the same standing pose",
		);

	const faces = new Map();
	drawn.forEach((entry) => {
		const index = entry.index;
		for (const actor of actorsOf(entry)) {
			if (typeof actor.avatar !== "string") continue;
			const held = faces.get(actor.avatar) ?? [];
			held.push({ index, face: String(actor.emotion ?? "neutral") });
			faces.set(actor.avatar, held);
		}
	});
	for (const [avatar, held] of faces) {
		let run = 1;
		for (let i = 1; i < held.length; i++) {
			const previous = held[i - 1];
			const current = held[i];
			run =
				current.face === previous.face && current.index === previous.index + 1
					? run + 1
					: 1;
			if (run === 3)
				warn(
					"panels",
					`${avatar} wears "${current.face}" in panels[${current.index - 2}] through panels[${current.index}]; vary the face`,
				);
		}
	}
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
	checkShape(raw.panels);
}

// ?s= is deflated, ?script= plain; the studio reads both
function link(strip, base) {
	const json = Buffer.from(JSON.stringify(strip));
	const packed = deflateRawSync(json, { level: 9 }).toString("base64url");
	const plain = json.toString("base64url");
	const query =
		packed.length < plain.length ? `s=${packed}` : `script=${plain}`;
	return `${base.replace(/\/$/, "")}/studio.html?${query}`;
}

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = baseFlag >= 0 ? args[baseFlag + 1] : DEFAULT_BASE;
const baseValue = baseFlag >= 0 ? baseFlag + 1 : -1;
const open = args.includes("--open");
const file = args.find(
	(arg, index) => !arg.startsWith("--") && index !== baseValue,
);
if (!file) {
	console.error("usage: strip-link.mjs <strip.json> [--base <url>] [--open]");
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
const cards = strip.panels.filter((panel) => panel.kind === "title").length;
console.log(
	`ok: ${strip.panels.length} panel(s)${cards ? ` including ${cards} title card` : ""}, ${cast.size} character(s), ${url.length} byte link`,
);
console.log(url);

if (open) {
	const [command, commandArgs] =
		process.platform === "win32"
			? ["cmd", ["/c", "start", "", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
}
