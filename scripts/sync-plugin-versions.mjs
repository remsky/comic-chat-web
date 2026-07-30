#!/usr/bin/env node
// npm "version" hook: stamp plugin manifests and stage them for the release commit.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const version = process.env.npm_package_version;
if (!version) {
	console.error("sync-plugin-versions: no npm_package_version set");
	process.exit(1);
}

const MANIFESTS = [
	"plugins/comic-strip/.claude-plugin/plugin.json",
	"plugins/comic-strip/.codex-plugin/plugin.json",
	".claude-plugin/marketplace.json",
];

for (const file of MANIFESTS) {
	if (!existsSync(file)) {
		console.error(`sync-plugin-versions: ${file} not found, skipping`);
		continue;
	}
	const raw = readFileSync(file, "utf8");
	const stamped = raw.replace(/("version"\s*:\s*)"[^"]*"/g, `$1"${version}"`);
	if (stamped === raw) continue;
	writeFileSync(file, stamped);
	execFileSync("git", ["add", file], { stdio: "inherit" });
}
