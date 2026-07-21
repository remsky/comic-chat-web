import { defineConfig } from "vite";

export default defineConfig({
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
