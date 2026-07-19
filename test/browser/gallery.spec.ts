import { expect, test } from "@playwright/test";

test("renders responsive, accessible comic panels", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/gallery.html");
	await expect(page.locator("#gallery")).toHaveAttribute("aria-busy", "false");
	const cards = page.locator(".panel-card");
	expect(await cards.count()).toBeGreaterThan(0);
	await expect(page.locator("canvas").first()).toHaveAttribute("role", "img");
	await expect(page.locator("canvas").first()).toHaveAttribute(
		"aria-label",
		/^Comic panel\./,
	);

	const layout = await page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		if (!canvas) throw new Error("missing canvas");
		const rect = canvas.getBoundingClientRect();
		return {
			backingRatio: canvas.width / rect.width,
			overflows: document.documentElement.scrollWidth > window.innerWidth,
			panelCount: document.querySelectorAll(".panel-card").length,
		};
	});
	expect(layout.panelCount).toBeGreaterThan(0);
	expect(layout.backingRatio).toBeCloseTo(
		Math.min(2, testInfo.project.use.deviceScaleFactor ?? 1),
		1,
	);
	expect(layout.overflows).toBe(false);

	const inkRatio = await page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		if (!canvas) throw new Error("missing canvas");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("missing context");
		const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let inked = 0;
		for (let i = 0; i < pixels.length; i += 4) {
			const alpha = pixels[i + 3] ?? 0;
			const luminance = (pixels[i] ?? 0) + (pixels[i + 1] ?? 0);
			if (alpha > 0 && luminance < 400) inked++;
		}
		return inked / (pixels.length / 4);
	});
	expect(inkRatio).toBeGreaterThan(0.005);

	const details = cards.first().locator("details");
	await details.locator("summary").click();
	await expect(details.locator("li").first()).toBeVisible();
	for (let index = 0; index < layout.panelCount; index++) {
		const canvas = cards.nth(index).locator("canvas");
		await canvas.scrollIntoViewIfNeeded();
		await expect
			.poll(() =>
				canvas.evaluate(
					(element) =>
						(element as HTMLCanvasElement).width /
						element.getBoundingClientRect().width,
				),
			)
			.toBeCloseTo(Math.min(2, testInfo.project.use.deviceScaleFactor ?? 1), 1);
	}
	expect(errors).toEqual([]);

	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("gallery.png"),
	});
});
