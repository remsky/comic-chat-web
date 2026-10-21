import { expect, test } from "./fixtures.js";

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
		document.querySelector("#title-room")?.append("responsive-preview");
		const roster = document.querySelector("#roster");
		if (roster) {
			for (const name of ["Alice", "Bob", "Charlie", "Danielle"]) {
				const item = document.createElement("li");
				item.textContent = name;
				roster.append(item);
			}
		}
		for (const id of ["bodycam", "background-picker", "notify-bell"])
			document.getElementById(id)?.removeAttribute("hidden");
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

test("connect screen drops the title where the buttons would cover it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 260, height: 640 });
	await page.goto("/");
	await expect(page.locator("#status")).toHaveAttribute("data-ready", "true");
	await expect(page.locator("#title-home")).toBeHidden();
});

for (const width of [320, 500]) {
	test(`connect screen title clears the buttons at ${width}px`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 640 });
		await page.goto("/");
		await expect(page.locator("#status")).toHaveAttribute("data-ready", "true");
		await expect(page.locator("#title-home")).toBeVisible();
		const clearance = await page.evaluate(() => {
			const title = document
				.querySelector("#title-home")
				?.getBoundingClientRect();
			const actions = document
				.querySelector(".titlebar-actions")
				?.getBoundingClientRect();
			return title && actions ? actions.left - title.right : NaN;
		});
		expect(clearance).toBeGreaterThanOrEqual(0);
	});
}

for (const viewport of [
	{ width: 1024, height: 768 },
	{ width: 720, height: 700 },
	{ width: 500, height: 640 },
	{ width: 390, height: 844 },
	{ width: 320, height: 640 },
]) {
	test(`joined shell adapts at ${viewport.width}x${viewport.height}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize(viewport);
		await stageJoinedRoom(page);

		await expectNoHorizontalOverflow(page);
		for (const selector of [".titlebar", ".workspace", ".composer"])
			await expect(page.locator(selector)).toBeInViewport();
		const titleLines = await page.locator("#title-home").evaluate((title) => {
			const { fontSize } = getComputedStyle(title);
			return title.getBoundingClientRect().height / Number.parseFloat(fontSize);
		});
		expect(titleLines).toBeLessThan(2);
		if (viewport.width <= 352)
			await expect(page.locator("#title-home")).toBeHidden();
		else await expect(page.locator("#title-home")).toBeVisible();
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
			await expect(page.locator("#bodycam-lock")).toBeHidden();
			await page.locator('.toolbar-button[data-panel="pose"]').click();
			await expect(page.locator("#bodycam-canvas")).toBeVisible();
			await expect(page.locator("#bodycam-lock")).toBeVisible();
			await expect(page.locator("#bodycam-send")).toBeVisible();
		} else {
			// desktop parks room/save/tweaks behind the More toggle
			await expect(page.locator("#save-strip")).toBeHidden();
			await page.locator("#sidebar-more").click();
			await page.locator(".tweaks-hint").scrollIntoViewIfNeeded();
			await expect(page.locator(".tweaks-hint")).toBeInViewport();
			await expect(page.locator("#save-strip")).toBeVisible();
			await expect(page.locator("#leave-room")).toBeVisible();
			await expect(page.locator("#modern-toggle")).toBeVisible();
			await expect(page.locator("#bodycam-canvas")).toBeVisible();
			await expect(page.locator("#bodycam-lock")).toBeVisible();
			await expect(page.locator("#bodycam-send")).toBeVisible();
		}

		await page.screenshot({
			path: testInfo.outputPath(
				`joined-${viewport.width}x${viewport.height}.png`,
			),
		});
	});
}
