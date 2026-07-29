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

export async function stripQuery(strip: unknown): Promise<string> {
	const json = new TextEncoder().encode(JSON.stringify(strip));
	const packed = toBase64Url(await deflateRaw(json));
	const plain = toBase64Url(json);
	return packed.length < plain.length ? `s=${packed}` : `script=${plain}`;
}

export interface StripLinks {
	studio: string;
	image: string;
}

export async function stripLinks(
	strip: unknown,
	base: string = DEFAULT_BASE,
): Promise<StripLinks> {
	const query = await stripQuery(strip);
	const root = base.replace(/\/$/, "");
	return {
		studio: `${root}/studio.html?${query}`,
		image: `${root}/strip.svg?${query}`,
	};
}
