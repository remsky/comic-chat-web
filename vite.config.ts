import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const entry = (file: string): string =>
	fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
	build: {
		rollupOptions: {
			input: { main: entry("index.html"), studio: entry("studio.html") },
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
