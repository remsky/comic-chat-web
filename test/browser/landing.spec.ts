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
	// static preview has no worker behind /api/rooms; the list must fail soft, not error
	await expect(page.locator("#room-list .room-list-empty")).toHaveText(
		"Room list unavailable.",
	);
	const characters = page.locator('#join-avatar input[name="avatar"]');
	expect(await characters.count()).toBeGreaterThanOrEqual(2);
	await expect(
		page.locator('#join-avatar input[name="avatar"]:checked'),
	).toHaveCount(1);
	await expect(page.locator("#join-avatar canvas")).toHaveCount(
		await characters.count(),
	);
	await page.locator("#join-name").fill("Alice");
	await page.locator("#join-name").blur();
	const aliceAvatar = await page
		.locator('#join-avatar input[name="avatar"]:checked')
		.inputValue();
	await page.locator("#join-name").fill("Bob");
	await page.locator("#join-name").blur();
	await expect(
		page.locator('#join-avatar input[name="avatar"]:checked'),
	).not.toHaveValue(aliceAvatar);
	expect(errors).toEqual([]);

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("landing.png"),
	});
});
