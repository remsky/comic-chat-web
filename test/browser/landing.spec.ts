import { expect, test } from "./fixtures.js";

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
	await expect(page.locator("#join-form .room-picker legend")).toBeVisible();
	await expect(page.locator("#room")).toBeHidden();
	// the grid fails soft: empty, no error
	await expect(
		page.locator('#join-room-options input[name="room"]'),
	).toHaveCount(0);
	const characters = page.locator('#join-avatar input[name="avatar"]');
	expect(await characters.count()).toBeGreaterThanOrEqual(2);
	// no default pick; selection is required on submit
	await expect(
		page.locator('#join-avatar input[name="avatar"]:checked'),
	).toHaveCount(0);
	await expect(page.locator("#join-avatar canvas")).toHaveCount(
		await characters.count(),
	);
	await characters.first().check();
	await expect(
		page.locator('#join-avatar input[name="avatar"]:checked'),
	).toHaveCount(1);
	expect(errors).toEqual([]);

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("landing.png"),
	});
});

test("a room link joins straight away with a remembered profile", async ({
	page,
}) => {
	const joins: string[] = [];
	await page.routeWebSocket("**/api/rooms/preview/websocket", (ws) => {
		ws.onMessage((frame) => joins.push(String(frame)));
	});
	await page.addInitScript(() => {
		localStorage.setItem(
			"comic-chat.profile",
			JSON.stringify({ name: "Ada", avatar: 1 }),
		);
	});
	await page.goto("/?room=preview");
	await expect(page.locator("#status")).toHaveText("Connecting…");
	await expect(page.locator("#join-form button")).toBeDisabled();
	await expect.poll(() => joins.length).toBeGreaterThan(0);
	expect(JSON.parse(joins[0] ?? "{}")).toMatchObject({
		type: "join",
		name: "Ada",
		avatar: 1,
	});
});
