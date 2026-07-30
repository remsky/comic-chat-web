#!/usr/bin/env node
// Emits the skill's plain-JS modules from the worker's TypeScript, so one authored copy serves both.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// biome and the parity test both key off this directory, so a new emit needs no config change
export const GENERATED =
	"plugins/comic-strip/skills/comic-strip/scripts/generated";

// each worker module imports only types, so stripping them leaves a module with no dependencies
export const EMITTED = [
	{ source: "worker/mcp/validate.ts", target: `${GENERATED}/validate.mjs` },
] as const;

export async function emitModule(
	source: string,
	sourcePath: string,
): Promise<string> {
	const banner = [
		`// Generated from ${sourcePath} by tools/generateValidator.ts. Do not edit.`,
		"// The plugin runs under bare node with no build step, so the worker's logic ships as plain JS.",
	].join("\n");
	const { code } = await transform(source, {
		loader: "ts",
		format: "esm",
		target: "node22",
	});
	return `${banner}\n\n${code}`;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	for (const { source, target } of EMITTED) {
		const emitted = await emitModule(
			readFileSync(join(root, source), "utf8"),
			source,
		);
		writeFileSync(join(root, target), emitted);
		console.log(`${target}: ${emitted.length} bytes`);
	}
}
