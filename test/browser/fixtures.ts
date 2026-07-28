import { test as base } from "@playwright/test";

// preview serves the static build alone, so an unstubbed /api call proxies to a worker that is not there
export const test = base.extend({
	page: async ({ page }, use) => {
		// static hosting answers this path with the shell; the directory fails soft on it
		await page.route("**/api/rooms", (route) =>
			route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
		);
		// a clean verdict, so the screen only blocks a strip a test flagged itself
		await page.route("**/api/moderate", (route) =>
			route.fulfill({ json: { flagged: [] } }),
		);
		await use(page);
	},
});

export { expect } from "@playwright/test";
