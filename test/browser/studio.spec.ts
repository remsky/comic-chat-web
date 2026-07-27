import { expect, test } from "@playwright/test";
import { stripMarkGrowth } from "../../src/browser/stripMark.js";

// the sheet geometry preview.ts exports at, which the assertions below rebuild
const EXPORT_GAP = 31;
const CARD_PIXELS = 600;

test("studio boots a strip and rebuilds it as the constructor changes", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));

	// vite preview serves no worker, so an unstubbed screen 502s into the error list
	await page.route("**/api/moderate", (route) =>
		route.fulfill({ json: { flagged: [] } }),
	);
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);

	const panels = page.locator("#studio-panels .spanel");
	await expect(panels).toHaveCount(2);
	await expect(page.locator("#studio-editor .pedit")).toHaveCount(2);
	await expect(page.locator("#studio-issues")).toBeHidden();

	// a balloon edit reaches the canvas transcript the panel exposes for screen readers
	await page
		.locator("#studio-editor .pedit")
		.first()
		.locator(".actor-text")
		.first()
		.fill("Testing one two");
	await expect(panels.first().locator("canvas")).toHaveAttribute(
		"aria-label",
		/TESTING ONE TWO/,
	);
	await expect(
		page.locator("#studio-editor .pedit").first().locator(".pedit-cast"),
	).toHaveText(/Testing one two/);

	await page
		.locator("#studio-editor")
		.getByRole("button", { name: "+ Panel" })
		.click();
	await expect(panels).toHaveCount(3);

	// deleting the empty panel leaves the first two untouched
	await page
		.locator("#studio-editor .pedit")
		.nth(2)
		.locator('button[aria-label="Delete panel 3"]')
		.click();
	await expect(panels).toHaveCount(2);

	expect(errors).toEqual([]);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("studio.png"),
	});
});

test("studio adds a title panel that draws the STARRING card", async ({
	page,
}) => {
	await page.route("**/api/moderate", (route) =>
		route.fulfill({ json: { flagged: [] } }),
	);
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);

	await page
		.locator("#studio-editor")
		.getByRole("button", { name: "+ Title" })
		.click();
	const panels = page.locator("#studio-panels .spanel");
	await expect(panels).toHaveCount(3);

	// the title card leads the strip, so it opens at the front
	const card = page.locator("#studio-editor .pedit").nth(0);
	await card.getByLabel("Title", { exact: true }).fill("NO EXIT");
	await card.getByRole("button", { name: "+ Character" }).click();
	await card.getByLabel("Credit name").fill("The Boss");

	await expect(panels.nth(0).locator("canvas")).toHaveAttribute(
		"aria-label",
		/NO EXIT/,
	);
	await expect(panels.nth(0).locator("canvas")).toHaveAttribute(
		"aria-label",
		/Starring: The Boss/,
	);

	// the subhead is the author's to write, and the card reads back what they wrote
	await card.getByLabel("Starring line").fill("TOLD BY");
	await expect(panels.nth(0).locator("canvas")).toHaveAttribute(
		"aria-label",
		/TOLD BY: The Boss/,
	);
	await expect(page.locator("#studio-json")).toHaveValue(/"kind": "title"/);
});

test("studio keeps one panel open and reorders from the grip", async ({
	page,
}) => {
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);

	const cards = page.locator("#studio-editor .pedit");
	const expanded = cards.locator(".pedit-toggle");
	await expect(expanded.nth(0)).toHaveAttribute("aria-expanded", "true");
	await expect(expanded.nth(1)).toHaveAttribute("aria-expanded", "false");

	// picking a panel out of the strip opens that one and closes the other
	await page.locator("#studio-panels .spanel").nth(1).click();
	await expect(expanded.nth(1)).toHaveAttribute("aria-expanded", "true");
	await expect(expanded.nth(0)).toHaveAttribute("aria-expanded", "false");

	const first = await cards.nth(0).locator(".pedit-cast").textContent();
	await cards.nth(0).locator(".pedit-grip").focus();
	await page.keyboard.press("ArrowDown");
	await expect(cards.nth(1).locator(".pedit-cast")).toHaveText(first ?? "");
});

test("studio reorders the strip by dragging a panel", async ({ page }) => {
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);

	const panels = page.locator("#studio-panels .spanel");
	const from = await panels.nth(0).boundingBox();
	const to = await panels.nth(1).boundingBox();
	if (!from || !to) throw new Error("the strip did not lay out");

	const before = await page
		.locator("#studio-editor .pedit")
		.nth(0)
		.locator(".pedit-cast")
		.textContent();
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 8,
	});
	await page.mouse.up();

	await expect(
		page.locator("#studio-editor .pedit").nth(1).locator(".pedit-cast"),
	).toHaveText(before ?? "");
});

test("studio loads a strip from the url and exports it as a png", async ({
	page,
}) => {
	const script = {
		version: 2,
		panels: [
			{ actors: [{ avatar: "anna", text: "from the url", emotion: "happy" }] },
		],
	};
	const encoded = Buffer.from(JSON.stringify(script))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	await page.goto(`/studio.html?script=${encoded}`);
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	await expect(page.locator("#studio-panels .spanel")).toHaveCount(1);
	await expect(page.locator("#studio-panels canvas")).toHaveAttribute(
		"aria-label",
		/FROM THE URL/,
	);

	const size = await page.evaluate(async () => {
		const studio = (
			window as unknown as { __studio: { png(): Promise<Blob | null> } }
		).__studio;
		const blob = await studio.png();
		return blob?.size ?? 0;
	});
	expect(size).toBeGreaterThan(1000);
});

test("panels per row shapes both the preview rows and the sheet", async ({
	page,
}) => {
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	const script = {
		version: 2,
		columns: 2,
		panels: Array.from({ length: 4 }, () => ({
			actors: [{ avatar: "anna", text: "row test" }],
		})),
	};
	await page.evaluate((strip) => {
		(
			window as unknown as { __studio: { load(script: unknown): unknown } }
		).__studio.load(strip);
	}, script);

	// four tiles over two columns puts the third on a new row
	const tops = await page
		.locator("#studio-panels .spanel")
		.evaluateAll((nodes) =>
			nodes.map((node) => node.getBoundingClientRect().y),
		);
	expect(tops[0]).toBe(tops[1]);
	expect(tops[2]).toBe(tops[3]);
	expect(tops[2]).toBeGreaterThan(tops[0] ?? 0);

	// the sheet is square at 2x2 plus the credit strip, one row wide once the count covers every panel
	const shape = async (): Promise<{ width: number; height: number }> =>
		page.evaluate(async () => {
			const studio = (
				window as unknown as { __studio: { png(): Promise<Blob | null> } }
			).__studio;
			const blob = await studio.png();
			if (!blob) throw new Error("no sheet");
			const bitmap = await createImageBitmap(blob);
			return { width: bitmap.width, height: bitmap.height };
		});
	await expect(page.locator("#studio-json")).toHaveValue(/"columns": 2/);
	const square = await shape();
	// square across the panel grid; the credit band under the last row is the only thing on top of it
	expect(square.height - stripMarkGrowth(square.width, EXPORT_GAP)).toBe(
		square.width,
	);

	// back to the default, which the document leaves out again
	await page.locator("#studio-columns").fill("4");
	await expect(page.locator("#studio-json")).not.toHaveValue(/columns/);
	const wide = await shape();
	expect(wide.width).toBeGreaterThan(square.width);
	expect(wide.height).toBeLessThan(square.height);
});

test("studio refuses to export a strip the screen flagged", async ({
	page,
}) => {
	// vite preview serves no worker, so the screen's verdict is stubbed at the network
	await page.route("**/api/moderate", (route) =>
		route.fulfill({ json: { flagged: [0] } }),
	);
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	await expect(page.locator("#studio-issues .sissue--error")).toHaveCount(1);

	const downloads: string[] = [];
	page.on("download", (download) =>
		downloads.push(download.suggestedFilename()),
	);
	const save = page.locator("#studio-save > summary");
	await save.click();
	await page.locator("#studio-export-json").click();
	await expect(page.locator("#studio-status")).toHaveText(/Export blocked/);
	// the pick put the menu away, so the second export opens it again
	await expect(page.locator("#studio-export-png")).toBeHidden();
	await save.click();
	await page.locator("#studio-export-png").click();
	await expect(page.locator("#studio-status")).toHaveText(/Export blocked/);
	expect(downloads).toEqual([]);

	// clearing the flag lets the same click through
	await page.unroute("**/api/moderate");
	await page.route("**/api/moderate", (route) =>
		route.fulfill({ json: { flagged: [] } }),
	);
	const download = page.waitForEvent("download");
	await save.click();
	await page.locator("#studio-export-json").click();
	expect((await download).suggestedFilename()).toBe("strip.json");
});

test("studio holds a flag on screen while the next verdict is in flight", async ({
	page,
}) => {
	// the stub answers slowly, so a redraw that dropped the flag would show a gap here
	await page.route("**/api/moderate", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 400));
		await route.fulfill({ json: { flagged: [0] } });
	});
	await page.goto("/studio.html");
	const issues = page.locator("#studio-issues .sissue--error");
	await expect(issues).toHaveCount(1);

	const text = page
		.locator("#studio-editor .pedit")
		.first()
		.locator(".actor-text")
		.first();
	for (const key of "abcd") {
		await text.pressSequentially(key);
		await expect(issues).toHaveCount(1);
	}
});

test("studio keeps flagged text off the canvas", async ({ page }) => {
	// the stub flags one word, so the panel can be watched across a clean edit and a flagged one
	await page.route("**/api/moderate", async (route) => {
		const body = route.request().postDataJSON() as { texts: string[] };
		const flagged = body.texts
			.map((text, index) => (text.includes("blorp") ? index : -1))
			.filter((index) => index >= 0);
		await route.fulfill({ json: { flagged } });
	});
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);

	const canvas = page.locator("#studio-panels .spanel canvas").first();
	const text = page
		.locator("#studio-editor .pedit")
		.first()
		.locator(".actor-text")
		.first();
	await text.fill("clean line");
	await expect(canvas).toHaveAttribute("aria-label", /CLEAN LINE/);

	await text.fill("blorp");
	await expect(page.locator("#studio-issues .sissue--error")).toHaveCount(1);
	// the balloon holds the line the screen cleared, so the flagged one never reaches the panel
	await expect(canvas).toHaveAttribute("aria-label", /CLEAN LINE/);
	await expect(canvas).not.toHaveAttribute("aria-label", /BLORP/);

	await text.fill("clean again");
	await expect(canvas).toHaveAttribute("aria-label", /CLEAN AGAIN/);
	await expect(page.locator("#studio-issues")).toBeHidden();
});

test("studio keeps an oversized shot inside its panel on the sheet", async ({
	page,
}) => {
	const script = {
		version: 2,
		panels: [
			{
				camera: "close",
				zoom: 1.8,
				actors: [{ avatar: "tiki", text: "no chat required" }],
			},
		],
	};
	const encoded = Buffer.from(JSON.stringify(script))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	await page.goto(`/studio.html?script=${encoded}`);
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	await expect(page.locator("#studio-panels .spanel")).toHaveCount(1);

	// the gutter around the panel must stay blank, however far the body runs past the frame
	const sheet = await page.evaluate(
		async ({ gap, card }) => {
			const studio = (
				window as unknown as { __studio: { png(): Promise<Blob | null> } }
			).__studio;
			const blob = await studio.png();
			if (!blob) return null;
			const bitmap = await createImageBitmap(blob);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext("2d");
			if (!context) return null;
			context.drawImage(bitmap, 0, 0);
			const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
			let bled = 0;
			// the band under the last row carries the credit mark, so the scan stops at the panel's bottom edge
			for (let y = 0; y < gap + card; y++)
				for (let x = 0; x < bitmap.width; x++) {
					if (x >= gap && x < bitmap.width - gap && y >= gap) continue;
					if ((data[(y * bitmap.width + x) * 4] ?? 255) < 250) bled++;
				}
			return { width: bitmap.width, height: bitmap.height, bled };
		},
		{ gap: EXPORT_GAP, card: CARD_PIXELS },
	);
	if (!sheet) throw new Error("no sheet");
	// pinned, so the scan floor above stays on the panel edge if the band ever grows
	expect(sheet.width).toBe(EXPORT_GAP + CARD_PIXELS + EXPORT_GAP);
	expect(sheet.height).toBe(
		EXPORT_GAP +
			CARD_PIXELS +
			EXPORT_GAP +
			stripMarkGrowth(sheet.width, EXPORT_GAP),
	);
	expect(sheet.bled).toBe(0);
});

test("studio reports a bad script instead of rendering it", async ({
	page,
}) => {
	await page.goto("/studio.html");
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	const issues = await page.evaluate(() => {
		const studio = (
			window as unknown as {
				__studio: { load(script: unknown): { path: string }[] };
			}
		).__studio;
		return studio.load({
			version: 2,
			panels: [{ actors: [{ avatar: "nobody", text: "hi" }] }],
		});
	});
	expect(issues.map((issue) => issue.path)).toEqual([
		"panels[0].actors[0].avatar",
	]);
});
