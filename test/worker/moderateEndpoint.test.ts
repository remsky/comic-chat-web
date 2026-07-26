import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function screen(body: unknown, method = "POST"): Promise<Response> {
	return SELF.fetch("https://comic.test/api/moderate", {
		method,
		headers: { "content-type": "application/json" },
		body: method === "POST" ? JSON.stringify(body) : undefined,
	});
}

describe("POST /api/moderate", () => {
	it("returns the indexes of the prohibited lines", async () => {
		const response = await screen({
			texts: ["hello there", "4rse off", "bye"],
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ flagged: [1] });
	});

	it("passes clean text through", async () => {
		const response = await screen({ texts: ["all clear"] });
		expect(await response.json()).toEqual({ flagged: [] });
	});

	it("still catches leetspeak and accented spellings", async () => {
		const response = await screen({ texts: ["what the ärse", "4rs3"] });
		expect(await response.json()).toEqual({ flagged: [0, 1] });
	});

	it("ignores non-string entries instead of failing the batch", async () => {
		const response = await screen({ texts: [null, 7, "clean"] });
		expect(await response.json()).toEqual({ flagged: [] });
	});

	it("rejects a missing or malformed body", async () => {
		expect((await screen({})).status).toBe(400);
		expect((await screen({ texts: "nope" })).status).toBe(400);
	});

	it("caps the batch size", async () => {
		const texts = Array.from({ length: 201 }, () => "hi");
		expect((await screen({ texts })).status).toBe(413);
	});

	it("refuses anything but POST", async () => {
		expect((await screen(undefined, "GET")).status).toBe(405);
	});

	it("has no route to offer when the deploy turned moderation off", async () => {
		const was = env.MODERATION;
		env.MODERATION = "off" as typeof was;
		try {
			expect((await screen({ texts: ["4rse off"] })).status).toBe(404);
		} finally {
			env.MODERATION = was;
		}
	});
});
