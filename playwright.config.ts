import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./test/browser",
	fullyParallel: true,
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
		command: "npm run dev -- --host 127.0.0.1 --port 4173",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: false,
	},
});
