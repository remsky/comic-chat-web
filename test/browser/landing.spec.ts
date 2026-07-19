import { expect, test } from "@playwright/test";

test("landing page boots the app shell with the connect dialog", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/?room=preview");
	await expect(page.locator("#status")).toHaveAttribute("data-ready", "true");
	await expect(page.locator(".titlebar-text")).toHaveText("Comic Chat Web");
	await expect(page.locator("#join-form")).toBeVisible();
	await expect(page.locator("#join-room")).toHaveValue("preview");
	await expect(page.locator("#room")).toBeHidden();
	const characters = page.locator("#join-avatar option");
	expect(await characters.count()).toBeGreaterThanOrEqual(2);
	expect(errors).toEqual([]);

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("landing.png"),
	});
});
