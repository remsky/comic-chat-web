const DEFAULT_BASE = "https://comics.remsky.art";

function toBase64Url(data: Uint8Array): string {
	const binary = Array.from(data, (byte) => String.fromCharCode(byte)).join("");
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function stripLink(
	strip: unknown,
	base: string = DEFAULT_BASE,
): Promise<string> {
	const json = new TextEncoder().encode(JSON.stringify(strip));
	const packed = toBase64Url(await deflateRaw(json));
	const plain = toBase64Url(json);
	const query =
		packed.length < plain.length ? `s=${packed}` : `script=${plain}`;
	return `${base.replace(/\/$/, "")}/studio.html?${query}`;
}
