#!/usr/bin/env node
// Checks a strip document against the published catalog, then prints the link that opens it in the studio.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { checkStrip } from "./generated/validate.mjs";

const DEFAULT_BASE = "https://comics.remsky.art";

const catalog = JSON.parse(
	readFileSync(new URL("../reference/catalog.json", import.meta.url), "utf8"),
);

// ?s= carries the deflated strip
function link(strip, base) {
	const json = Buffer.from(JSON.stringify(strip));
	const packed = deflateRawSync(json, { level: 9 }).toString("base64url");
	return `${base.replace(/\/$/, "")}/studio.html?s=${packed}`;
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

const issues = checkStrip(strip, catalog);
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
