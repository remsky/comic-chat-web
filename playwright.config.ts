import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test/browser",
	fullyParallel: true,
	// default is half the cores, which is 8 chromiums on a desktop
	workers: process.env.CI ? "50%" : 4,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:4173",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "desktop-chromium",
			use: {
				...devices["Desktop Chrome HiDPI"],
				viewport: { width: 1440, height: 1000 },
			},
		},
		{
			name: "mobile-chromium",
			use: {
				...devices["Pixel 7"],
				viewport: { width: 390, height: 844 },
			},
		},
	],
	webServer: {
		command:
			"npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: false,
		timeout: 120_000,
		// specs cover pack-gated characters, so build every pack
		env: { CHARACTER_PACKS: "all" },
	},
});
