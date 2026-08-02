import { expect, test } from "./fixtures.js";

function encodedScript(script: unknown): string {
	return Buffer.from(JSON.stringify(script))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

test("Peety composes emotion heads with gesture torsos", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	const atlasResponses: number[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("response", (response) => {
		// the atlas filename carries a content hash, so match the stem not the whole name
		if (/\/assets\/avatars\/peety-[0-9a-f]{10}\.png$/.test(response.url()))
			atlasResponses.push(response.status());
	});

	const script = {
		version: 2,
		panels: [
			{
				camera: "wide",
				actors: [{ avatar: "peety", emotion: "neutral" }],
			},
		],
	};
	await page.goto(`/studio.html?script=${encodedScript(script)}`);
	await expect(page.locator("body")).toHaveAttribute(
		"data-studio-ready",
		"true",
	);
	await expect(page.locator("#studio-issues")).toBeHidden();
	await expect.poll(() => atlasResponses).toEqual([200]);

	const canvas = page.locator("#studio-panels canvas").first();
	const row = page.locator("#studio-editor .actor").first();
	const emotion = row.getByRole("combobox", { name: "Emotion" });
	const gesture = row.getByRole("combobox", { name: "Gesture" });
	const pixels = () =>
		canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());

	const neutral = await pixels();
	await emotion.selectOption("bored");
	await expect.poll(pixels).not.toBe(neutral);
	let previous = await pixels();
	await canvas.screenshot({ path: testInfo.outputPath("peety-bored.png") });

	await gesture.selectOption("wave");
	await expect.poll(pixels).not.toBe(previous);
	previous = await pixels();
	await canvas.screenshot({ path: testInfo.outputPath("peety-wave.png") });

	for (const name of ["point", "pointself", "doublepoint", "shrug"]) {
		await gesture.selectOption(name);
		await expect.poll(pixels).not.toBe(previous);
		previous = await pixels();
		await canvas.screenshot({
			path: testInfo.outputPath(`peety-${name}.png`),
		});
	}

	await gesture.selectOption("");
	await expect.poll(pixels).not.toBe(previous);
	const noGesture = await pixels();
	await canvas.screenshot({
		path: testInfo.outputPath("peety-no-gesture.png"),
	});
	const camera = page.getByRole("group", { name: "Camera" }).first();
	await camera.getByRole("button", { name: "Close" }).click();
	await expect.poll(pixels).not.toBe(noGesture);
	const closeNoGesture = await pixels();
	await canvas.screenshot({
		path: testInfo.outputPath("peety-close-no-gesture.png"),
	});
	await gesture.selectOption("wave");
	await expect.poll(pixels).not.toBe(closeNoGesture);
	await canvas.screenshot({
		path: testInfo.outputPath("peety-close-wave.png"),
	});
	await gesture.selectOption("");
	await camera.getByRole("button", { name: "Wide" }).click();
	await expect.poll(pixels).toBe(noGesture);
	const facing = row.getByRole("button", { name: "Facing right" });
	await facing.click();
	await expect.poll(pixels).not.toBe(noGesture);
	await row.getByRole("button", { name: "Facing left" }).click();
	await expect.poll(pixels).toBe(noGesture);

	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.x).toBeGreaterThanOrEqual(0);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth),
	);
	expect(errors).toEqual([]);
	await page.screenshot({
		fullPage: true,
		path: testInfo.outputPath("peety-complex.png"),
	});
});
