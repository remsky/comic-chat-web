import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { screenStrip } from "../../worker/mcp/screen.js";
import { isProhibited } from "../../worker/moderation.js";
import { mintShortLink } from "../../worker/shortlink.js";

describe("short links", () => {
	it("mints a slug and redirects to the packed studio link", async () => {
		const slug = await mintShortLink(env.SHORTLINKS, "s=abc123", 100);
		expect(slug).toMatch(/^[a-z]+-[a-z]+-\d{1,4}$/);
		const response = await SELF.fetch(`https://comic.test/studio/s/${slug}`, {
			redirect: "manual",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://comic.test/studio.html?s=abc123",
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("redirects the .svg variant to the strip renderer", async () => {
		const slug = await mintShortLink(env.SHORTLINKS, "s=abc123", 100);
		const response = await SELF.fetch(
			`https://comic.test/studio/s/${slug}.svg`,
			{ redirect: "manual" },
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://comic.test/studio/strip.svg?s=abc123",
		);
	});

	it("answers an expired .svg with an svg placeholder", async () => {
		const response = await SELF.fetch(
			"https://comic.test/studio/s/bravo-gerbil-1.svg",
		);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toBe("image/svg+xml");
		expect(await response.text()).toContain("link expired");
	});

	it("serves the expired page for unknown slugs", async () => {
		const response = await SELF.fetch(
			"https://comic.test/studio/s/bravo-gerbil-1",
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Link expired");
	});

	it("rejects malformed slugs without touching the store", async () => {
		const response = await SELF.fetch(
			"https://comic.test/studio/s/UPPER_case!!",
		);
		expect(response.status).toBe(404);
	});

	it("refuses non-GET methods", async () => {
		const response = await SELF.fetch(
			"https://comic.test/studio/s/bravo-gerbil-1",
			{
				method: "POST",
			},
		);
		expect(response.status).toBe(405);
	});

	it("stops minting once the live-link cap is reached", async () => {
		await env.SHORTLINKS.put("link:filler-vole-1", "s=a");
		await env.SHORTLINKS.put("link:filler-vole-2", "s=b");
		const live = (await env.SHORTLINKS.list({ prefix: "link:" })).keys.length;
		expect(await mintShortLink(env.SHORTLINKS, "s=blocked", live)).toBeNull();
		expect(
			await mintShortLink(env.SHORTLINKS, "s=allowed", live + 2),
		).not.toBeNull();
	});

	it("stores each mint under its own link key", async () => {
		const first = await mintShortLink(env.SHORTLINKS, "s=first", 100);
		const second = await mintShortLink(env.SHORTLINKS, "s=second", 100);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(await env.SHORTLINKS.get(`link:${first}`)).toBe("s=first");
		expect(await env.SHORTLINKS.get(`link:${second}`)).toBe("s=second");
	});
});

describe("screenStrip", () => {
	it("flags balloon and title text through the moderation matcher", () => {
		const flagged = screenStrip(
			{
				panels: [
					{ title: "4rse", actors: [{ text: "clean words" }] },
					{ actors: [{ text: "what the ärse" }] },
				],
			},
			isProhibited,
		);
		expect(flagged).toEqual(["panels[0].title", "panels[1].actors[0].text"]);
	});

	it("passes a clean strip untouched", () => {
		const flagged = screenStrip(
			{ panels: [{ title: "The Test", actors: [{ text: "hello there" }] }] },
			isProhibited,
		);
		expect(flagged).toEqual([]);
	});
});
