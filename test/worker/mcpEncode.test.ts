import { describe, expect, it } from "vitest";
import { base64urlDecode } from "../../src/protocol/base64url.js";
import { loadBlob } from "../../worker/mcp/docs.js";
import { stripQuery } from "../../worker/mcp/link.js";

const bytes = Uint8Array.from({ length: 1024 }, (_, i) => (i * 7) % 256);
const assets = {
	fetch: async () =>
		new Response(bytes, { headers: { "content-type": "image/png" } }),
} as unknown as Fetcher;

describe("the MCP encoders", () => {
	it("base64 of a blob matches the byte-by-byte reference", async () => {
		const reference = btoa(String.fromCharCode(...bytes));
		expect(await loadBlob(assets, "thumbs/blob.png")).toBe(reference);
	});

	it("a strip query is unpadded base64url the client can inflate", async () => {
		const strip = { version: 2, panels: [{ actors: [{ avatar: "dan" }] }] };
		const query = await stripQuery(strip);
		expect(query).toMatch(/^s=[\w-]+$/);
		const packed = base64urlDecode(query.slice(2));
		const inflated = await new Response(
			new Blob([packed])
				.stream()
				.pipeThrough(new DecompressionStream("deflate-raw")),
		).text();
		expect(JSON.parse(inflated)).toEqual(strip);
	});
});
