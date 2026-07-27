import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
	CATALOG_FILE,
	catalogFromManifests,
} from "./src/studio/catalogJson.js";
import {
	type OperatorValues,
	robotsTxt,
	sitemapXml,
	substituteOperator,
} from "./tools/operatorHtml.js";

const entry = (file: string): string =>
	fileURLToPath(new URL(file, import.meta.url));

// what a script author may name, probed off the committed art rather than restated by hand
function publishedCatalog(): string {
	const read = (file: string) => readFileSync(entry(file), "utf8");
	return JSON.stringify(
		catalogFromManifests(
			read("public/assets/avatars/manifest.json"),
			read("public/assets/backgrounds/manifest.json"),
		),
	);
}

function stripCatalog(): Plugin {
	return {
		name: "strip-catalog",
		// dev serves it too, so a skill tested against localhost reads the same file the build emits
		configureServer(server) {
			server.middlewares.use(`/${CATALOG_FILE}`, (_request, response) => {
				response.setHeader("content-type", "application/json");
				response.end(publishedCatalog());
			});
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: CATALOG_FILE,
				source: publishedCatalog(),
			});
		},
	};
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

export default defineConfig({
	plugins: [operatorPages(), stripCatalog()],
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
});
