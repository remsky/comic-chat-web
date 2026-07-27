import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
	ART_PACKS,
	PACK_IDS,
	resolvePacks,
	unknownPacks,
} from "./src/protocol/castPacks.js";
import {
	CATALOG_FILE,
	catalogFromManifests,
	shippedManifests,
} from "./src/studio/catalogJson.js";
import {
	type OperatorValues,
	robotsTxt,
	sitemapXml,
	substituteOperator,
} from "./tools/operatorHtml.js";

const entry = (file: string): string =>
	fileURLToPath(new URL(file, import.meta.url));

const AVATAR_MANIFEST = "assets/avatars/manifest.json";
const BACKDROP_MANIFEST = "assets/backgrounds/manifest.json";

// a copy of public/ holding only the shipped cast, handed to vite as publicDir
function shippedPublicDir(mode: string): string {
	const value = loadEnv(mode, entry("."), "").CHARACTER_PACKS;
	const unknown = unknownPacks(value);
	if (unknown.length > 0)
		throw new Error(
			`CHARACTER_PACKS names no such pack: ${unknown.join(", ")}. Use ${PACK_IDS.join(", ")}, all, or none`,
		);
	const packs = resolvePacks(value);
	const source = entry("public");
	const dropped = new Set(
		ART_PACKS.filter((pack) => !packs.has(pack.id)).flatMap((pack) => [
			...pack.characters.map((name) =>
				resolve(source, "assets/avatars", `${name}.png`),
			),
			...pack.backdrops.map((name) =>
				resolve(source, "assets/backgrounds", `${name}.png`),
			),
		]),
	);
	const staged = entry("node_modules/.cache/art-packs/public");
	rmSync(staged, { recursive: true, force: true });
	cpSync(source, staged, {
		recursive: true,
		filter: (file) => !dropped.has(resolve(file)),
	});
	const read = (file: string) => readFileSync(join(source, file), "utf8");
	const manifests = shippedManifests(
		read(AVATAR_MANIFEST),
		read(BACKDROP_MANIFEST),
		packs,
	);
	writeFileSync(join(staged, AVATAR_MANIFEST), manifests.avatars);
	writeFileSync(join(staged, BACKDROP_MANIFEST), manifests.backgrounds);
	writeFileSync(
		join(staged, CATALOG_FILE),
		JSON.stringify(
			catalogFromManifests(manifests.avatars, manifests.backgrounds),
		),
	);
	return staged;
}

// the empty prefix takes plain names, so Workers Builds vars and a local .env read the same
function operatorPages(): Plugin {
	let values: OperatorValues = {};
	return {
		name: "operator-pages",
		configResolved(config) {
			values = loadEnv(config.mode, config.root, "");
		},
		transformIndexHtml: {
			order: "pre",
			handler: (html) => substituteOperator(html, values),
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "robots.txt",
				source: robotsTxt(values.SITE_ORIGIN),
			});
			const sitemap = sitemapXml(values.SITE_ORIGIN);
			if (sitemap)
				this.emitFile({
					type: "asset",
					fileName: "sitemap.xml",
					source: sitemap,
				});
		},
	};
}

export default defineConfig(({ mode }) => ({
	publicDir: shippedPublicDir(mode),
	plugins: [operatorPages()],
	build: {
		rollupOptions: {
			input: {
				main: entry("index.html"),
				studio: entry("studio.html"),
				legal: entry("legal.html"),
				report: entry("report.html"),
			},
		},
	},
	// so `vite` (HMR) can borrow the worker's /api + room websockets from a `wrangler dev` on :8787
	server: {
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8787",
				changeOrigin: true,
				ws: true,
			},
		},
	},
}));
