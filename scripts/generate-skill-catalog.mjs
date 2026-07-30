// Emits the skill's vendored catalog.json from the modules the build itself uses, so the reference cannot drift from the deploy.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGET = "plugins/comic-strip/skills/comic-strip/reference/catalog.json";

// src/ imports carry .js specifiers, so bare node cannot load these modules until esbuild resolves them
const cache = join(root, "node_modules/.cache/skill-catalog");
mkdirSync(cache, { recursive: true });
const bundle = join(cache, "catalog.mjs");
await build({
	stdin: {
		contents: [
			'export { catalogFromManifests, shippedManifests, SKILL_REFERENCE } from "./src/studio/catalogJson.js";',
			'export { resolvePacks, VENDORED_PACKS } from "./src/protocol/castPacks.js";',
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	outfile: bundle,
});

const {
	catalogFromManifests,
	resolvePacks,
	shippedManifests,
	SKILL_REFERENCE,
	VENDORED_PACKS,
} = await import(pathToFileURL(bundle).href);

const read = (file) => readFileSync(join(root, file), "utf8");
const shipped = shippedManifests(
	read("public/assets/avatars/manifest.json"),
	read("public/assets/backgrounds/manifest.json"),
	resolvePacks(VENDORED_PACKS),
);
const catalog = catalogFromManifests(
	shipped.avatars,
	shipped.backgrounds,
	read(`${SKILL_REFERENCE}/cast.md`),
);

// biome does not format this file, so the emitted bytes are the committed bytes
writeFileSync(join(root, TARGET), `${JSON.stringify(catalog, null, "\t")}\n`);
console.log(`wrote ${TARGET}`);
