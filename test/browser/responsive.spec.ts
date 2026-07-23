import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(
	page: import("@playwright/test").Page,
) {
	const metrics = await page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
	}));
	expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

async function stageJoinedRoom(page: import("@playwright/test").Page) {
	await page.goto("/?room=responsive-preview");
	await expect(page.locator("#status")).toHaveAttribute("data-ready", "true");
	await page.evaluate(() => {
		document.body.classList.add("joined");
		document.querySelector("#title-room")?.append("- responsive-preview");
		const roster = document.querySelector("#roster");
		if (roster) {
			for (const name of ["Alice", "Bob", "Charlie", "Danielle"]) {
				const item = document.createElement("li");
				item.textContent = name;
				roster.append(item);
			}
		}
		for (const id of ["bodycam", "background-picker"])
			document.getElementById(id)?.removeAttribute("hidden");
		const status = document.querySelector("#bodycam-status");
		if (status) status.textContent = "Neutral";
		const panels = document.querySelector("#panels");
		if (panels) {
			for (let index = 0; index < 8; index++) {
				const panel = document.createElement("figure");
				panel.className = "panel";
				const canvas = document.createElement("canvas");
				canvas.width = 600;
				canvas.height = 600;
				panel.append(canvas);
				panels.append(panel);
			}
		}
	});
}

test("connect dialog fits a narrow desktop viewport", async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 640 });
	await page.goto("/");
	await expect(page.locator("#status")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#join-form")).toBeVisible();
	await expectNoHorizontalOverflow(page);
	await expect(page.locator(".dialog")).toBeInViewport();
});

for (const viewport of [
	{ width: 1024, height: 768 },
	{ width: 720, height: 700 },
	{ width: 500, height: 640 },
	{ width: 390, height: 844 },
]) {
	test(`joined shell adapts at ${viewport.width}x${viewport.height}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize(viewport);
		await stageJoinedRoom(page);

		await expectNoHorizontalOverflow(page);
		for (const selector of [".titlebar", ".workspace", ".composer"])
			await expect(page.locator(selector)).toBeInViewport();
		// joined mobile hides the legal line; panels own the screen
		if (viewport.width <= 760)
			await expect(page.locator(".legal-footer")).toBeHidden();
		else await expect(page.locator(".legal-footer")).toBeInViewport();

		const panelFit = await page
			.locator(".panel")
			.first()
			.evaluate((panel) => {
				const panelRect = panel.getBoundingClientRect();
				const canvasRect = panel
					.querySelector("canvas")
					?.getBoundingClientRect();
				return canvasRect ? canvasRect.width <= panelRect.width + 1 : false;
			});
		expect(panelFit).toBe(true);

		await page.screenshot({
			path: testInfo.outputPath(
				`joined-initial-${viewport.width}x${viewport.height}.png`,
			),
		});

		// narrow widths park the sidebar in the tap-open sheet
		if (viewport.width <= 760) {
			await page.locator('.toolbar-button[data-panel="more"]').click();
			await expect(page.locator("#save-strip")).toBeVisible();
			await expect(page.locator("#leave-room")).toBeVisible();
			await expect(page.locator("#profile-name")).toBeVisible();
			await expect(page.locator("#avatar-edit")).toBeVisible();
			await expect(page.locator("#modern-toggle")).toBeVisible();
			await expect(page.locator(".tweaks-hint")).toBeInViewport();
			await expect(page.locator("#bodycam-menu-button")).toBeHidden();
			await page.locator('.toolbar-button[data-panel="pose"]').click();
			await expect(page.locator("#bodycam-canvas")).toBeVisible();
			await expect(page.locator("#bodycam-menu-button")).toBeVisible();
		} else {
			await page.locator(".tweaks-hint").scrollIntoViewIfNeeded();
			await expect(page.locator(".tweaks-hint")).toBeInViewport();
			await expect(page.locator("#save-strip")).toBeVisible();
			await expect(page.locator("#leave-room")).toBeVisible();
			await expect(page.locator("#modern-toggle")).toBeVisible();
			await expect(page.locator("#bodycam-canvas")).toBeVisible();
			await expect(page.locator("#bodycam-menu-button")).toBeVisible();
		}

		await page.screenshot({
			path: testInfo.outputPath(
				`joined-${viewport.width}x${viewport.height}.png`,
			),
		});
	});
}
