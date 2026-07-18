import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				main: fileURLToPath(new URL("./index.html", import.meta.url)),
				room: fileURLToPath(new URL("./room.html", import.meta.url)),
			},
		},
	},
});
