import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
	type OperatorValues,
	robotsTxt,
	sitemapXml,
	substituteOperator,
} from "./tools/operatorHtml.js";

const entry = (file: string): string =>
	fileURLToPath(new URL(file, import.meta.url));

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
});
